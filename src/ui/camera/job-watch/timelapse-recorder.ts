// Records a job's timelapse (ADR-490): while the job is running (not while it
// is paused), a frame every interval, thinned evenly when a long job reaches
// the frame limit, and one last frame of the finished piece. A fixed,
// calibrated camera gives flat pictures of the job's part of the bed, so the
// video shows the work square-on; if the first frame cannot be flattened, the
// whole recording uses plain frames so the video keeps one size.
//
// ADR-490 Amendment 3 (camera audit v2 K4-P2-1, K4-P3-1). Five failed
// captures in a row used to end the recording for the rest of the job, and
// with the bridge's back-off (ADR-692 Amendment 1) two hiccups a second apart
// were five: a 1 s Wi-Fi drop, a 3 s login page or one 10-20 s stall stopped
// a 3-hour timelapse for good. A missed frame is now skipped: the next try
// waits for the next interval (so the bridge's held-back answers are not
// fetched every 250 ms), the panel note and one toast say frames are being
// missed, and the recording carries on when pictures come back. A picture
// whose size no longer fits a flat recording is skipped the same way, not
// fetched again every 250 ms.

import type { PictureClient } from '../picture-worker/camera-picture-client';
import type { PictureReply } from '../picture-worker/picture-work';
import { watchPixelsPerMm } from '../../../core/camera/job-watch/job-area';
import {
  addTimelapseFrame,
  emptyTimelapse,
  timelapseFrameDue,
  type Timelapse,
} from '../../../core/camera/job-watch/timelapse-frames';
import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import {
  flattenedPicture,
  watchCameraStillRunning,
  type WatchCamera,
  type WatchIo,
  flattenSpecFor,
  JPEG_QUALITY,
} from './job-watch-camera';
import { useToastStore } from '../../state/toast-store';
import { useJobWatchStore } from './job-watch-store';

export const TIMELAPSE_MAX_SIDE_PX = 1024;
const FLAT_LIMITS = { maxPixelsPerMm: 4, maxSidePx: TIMELAPSE_MAX_SIDE_PX, maxPixels: 1_500_000 };
const TICK_MS = 250;
/** Missed frames in a row before the panel note and a toast say so. */
export const MISSED_FRAMES_TO_SAY = 3;
const MISSED_NOTE =
  'The camera has not sent a picture for a while, so frames are being skipped. The recording carries on when pictures come back.';
const RESIZED_NOTE =
  "The camera's picture changed size, so it no longer lines up with the calibration: frames are skipped until it does.";

export type TimelapseRecorder = {
  /** Stop taking frames at the interval (the job ended). */
  readonly stop: () => void;
  /** Add the finished piece's frame, when there is one, and end the recording. */
  readonly finish: (frame: RgbaImage | null) => Promise<void>;
};

type RecorderArgs = {
  readonly camera: WatchCamera;
  readonly region: BedArea | null;
  readonly intervalMs: number;
  readonly io: WatchIo;
  readonly jobRunning: () => boolean;
  /** False once a newer job owns the store, so a late frame cannot land in its timelapse. */
  readonly isCurrent: () => boolean;
};

type Recording = {
  flat: boolean;
  timelapse: Timelapse<Blob>;
  stopped: boolean;
  /** Frames missed in a row. */
  missed: number;
  /** No try before this time, after a missed frame. */
  nextTryAt: number;
  /** The missed-frames toast was shown for this recording. */
  toasted: boolean;
};

/** What one try at a frame gave. */
type Taken = Blob | 'again' | 'no-picture' | 'resized';

export function startTimelapse(args: RecorderArgs): TimelapseRecorder {
  const { camera, io } = args;
  const recording: Recording = {
    flat: camera.fixedModel !== null && args.region !== null,
    timelapse: emptyTimelapse(args.intervalMs),
    stopped: false,
    missed: 0,
    nextTryAt: Number.NEGATIVE_INFINITY,
    toasted: false,
  };
  const keep = async (frame: RgbaImage, atMs: number): Promise<void> => {
    const blob = await encodedFrame(recording, args, frame);
    if (typeof blob === 'string') return;
    recording.timelapse = addTimelapseFrame(recording.timelapse, blob, atMs);
    publish(recording, args);
  };
  const end = (reason: string): void => {
    recording.stopped = true;
    const count = recording.timelapse.frames.length;
    const note = `${reason} The timelapse stopped at ${count} frames.`;
    publish(recording, args, { note });
    // Said where the operator is, not only in the Camera panel (ADR-490 Amendment 3).
    if (args.isCurrent()) {
      useToastStore
        .getState()
        .pushToast(`Timelapse: ${note}`, 'warning', { key: 'timelapse-ended' });
    }
  };
  const tick = async (): Promise<void> => {
    const now = io.now();
    if (!args.jobRunning() || now < recording.nextTryAt) return;
    if (!timelapseFrameDue(recording.timelapse, now)) return;
    const client = io.picture ?? null;
    const taken =
      client !== null
        ? await workedFrame(recording, args, client)
        : await windowFrame(recording, args);
    if (recording.stopped || taken === 'again') return;
    if (taken === 'no-picture' || taken === 'resized') {
      missedFrame(recording, args, now, taken);
      return;
    }
    if (recording.missed > 0) publish(recording, args, { note: null });
    recording.missed = 0;
    recording.timelapse = addTimelapseFrame(recording.timelapse, taken, now);
    publish(recording, args);
  };
  const loop = async (): Promise<void> => {
    while (!recording.stopped) {
      if (!watchCameraStillRunning(camera)) {
        end('The camera was turned off or switched.');
        return;
      }
      await tick();
      if (!recording.stopped) await io.wait(TICK_MS);
    }
  };
  publish(recording, args, { recording: true, note: null });
  void loop();
  return {
    stop: () => {
      recording.stopped = true;
    },
    finish: async (frame) => {
      recording.stopped = true;
      if (frame !== null) await keep(frame, io.now());
      publish(recording, args, { recording: false });
    },
  };
}

// A frame the camera did not give: try again at the next interval, and say so
// once a few have been missed in a row.
function missedFrame(
  recording: Recording,
  args: RecorderArgs,
  now: number,
  why: 'no-picture' | 'resized',
): void {
  recording.missed += 1;
  recording.nextTryAt = now + args.intervalMs;
  if (recording.missed !== MISSED_FRAMES_TO_SAY) return;
  const note = why === 'resized' ? RESIZED_NOTE : MISSED_NOTE;
  publish(recording, args, { note });
  if (recording.toasted || !args.isCurrent()) return;
  recording.toasted = true;
  useToastStore.getState().pushToast(`Timelapse: ${note}`, 'warning', { key: 'timelapse-missed' });
}

function publish(
  recording: Recording,
  args: RecorderArgs,
  patch: { readonly recording?: boolean; readonly note?: string | null } = {},
): void {
  if (!args.isCurrent()) return;
  const current = useJobWatchStore.getState().timelapse;
  useJobWatchStore.setState({
    timelapse: {
      frames: recording.timelapse.frames,
      intervalMs: recording.timelapse.intervalMs,
      flat: recording.flat,
      recording: patch.recording ?? current?.recording ?? true,
      note: patch.note === undefined ? (current?.note ?? null) : patch.note,
    },
  });
}

// The frame read, flattened and encoded by the picture worker, off the UI
// thread (ADR-490 Amendment 2); the rules are encodedFrame's. A first frame
// that cannot be flattened turns the recording plain from the next frame.
async function workedFrame(
  recording: Recording,
  args: RecorderArgs,
  client: PictureClient,
): Promise<Taken> {
  const bitmap = await client.capture(args.camera.source);
  if (bitmap === null) return 'no-picture';
  const plain = {
    op: 'jpeg',
    frame: bitmap,
    maxSidePx: TIMELAPSE_MAX_SIDE_PX,
    quality: JPEG_QUALITY,
  } as const;
  if (!recording.flat || args.region === null) return jpegOf(await client.run(plain));
  const ppm = watchPixelsPerMm(args.region, FLAT_LIMITS);
  const spec = flattenSpecFor(args.camera, bitmap.width, bitmap.height, args.region, ppm);
  if (spec.kind === 'ok') {
    const reply = await client.run({ ...plain, flatten: spec.spec });
    if (reply.kind !== 'unseen') return jpegOf(reply);
  } else {
    bitmap.close();
  }
  return cannotFlatten(recording);
}

// A worker that fails is a missed frame too, tried again at the next interval.
function jpegOf(reply: PictureReply): Taken {
  return reply.kind === 'jpeg' ? reply.blob : 'no-picture';
}

// The first frame turns the recording plain and is taken again at once; a
// later one no longer fits the flat recording and is skipped.
function cannotFlatten(recording: Recording): Taken {
  if (recording.timelapse.frames.length > 0) return 'resized';
  recording.flat = false;
  return 'again';
}

// The window's own capture, where there is no picture worker.
async function windowFrame(recording: Recording, args: RecorderArgs): Promise<Taken> {
  const frame = await args.io.captureFrame(args.camera.source);
  if (frame === null) return 'no-picture';
  return encodedFrame(recording, args, frame);
}

// A flat picture while the recording is flat; if the very first frame cannot
// be flattened the recording turns plain, and a later one is skipped instead.
async function encodedFrame(
  recording: Recording,
  args: RecorderArgs,
  frame: RgbaImage,
): Promise<Taken> {
  if (recording.flat && args.region !== null) {
    const ppm = watchPixelsPerMm(args.region, FLAT_LIMITS);
    const picture = flattenedPicture(args.camera, frame, args.region, ppm);
    if (picture.kind === 'ok') return encoded(args, picture.image);
    if (recording.timelapse.frames.length > 0) return 'resized';
    recording.flat = false;
  }
  return encoded(args, frame);
}

async function encoded(args: RecorderArgs, image: RgbaImage): Promise<Taken> {
  return (await args.io.encodeJpeg(image, TIMELAPSE_MAX_SIDE_PX)) ?? 'no-picture';
}
