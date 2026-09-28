// Records a job's timelapse (ADR-490): while the job is running (not while it
// is paused), a frame every interval, thinned evenly when a long job reaches
// the frame limit, and one last frame of the finished piece. A fixed,
// calibrated camera gives flat pictures of the job's part of the bed, so the
// video shows the work square-on; if the first frame cannot be flattened, the
// whole recording uses plain frames so the video keeps one size.

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
} from './job-watch-camera';
import { useJobWatchStore } from './job-watch-store';

export const TIMELAPSE_MAX_SIDE_PX = 1024;
const FLAT_LIMITS = { maxPixelsPerMm: 4, maxSidePx: TIMELAPSE_MAX_SIDE_PX, maxPixels: 1_500_000 };
const TICK_MS = 250;
const MAX_FAILED_CAPTURES = 5;

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
  failures: number;
};

export function startTimelapse(args: RecorderArgs): TimelapseRecorder {
  const { camera, io } = args;
  const recording: Recording = {
    flat: camera.fixedModel !== null && args.region !== null,
    timelapse: emptyTimelapse(args.intervalMs),
    stopped: false,
    failures: 0,
  };
  const keep = async (frame: RgbaImage, atMs: number): Promise<void> => {
    const blob = await encodedFrame(recording, args, frame);
    if (blob === null) return;
    recording.timelapse = addTimelapseFrame(recording.timelapse, blob, atMs);
    publish(recording, args);
  };
  const end = (reason: string): void => {
    recording.stopped = true;
    const count = recording.timelapse.frames.length;
    publish(recording, args, { note: `${reason} The timelapse stopped at ${count} frames.` });
  };
  const tick = async (): Promise<void> => {
    const now = io.now();
    if (!args.jobRunning() || !timelapseFrameDue(recording.timelapse, now)) return;
    const frame = await io.captureFrame(camera.source);
    if (recording.stopped) return;
    if (frame === null) {
      recording.failures += 1;
      if (recording.failures >= MAX_FAILED_CAPTURES) end('The camera stopped sending pictures.');
      return;
    }
    recording.failures = 0;
    await keep(frame, now);
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

// A flat picture while the recording is flat; if the very first frame cannot
// be flattened the recording turns plain, and a later one is skipped instead.
async function encodedFrame(
  recording: Recording,
  args: RecorderArgs,
  frame: RgbaImage,
): Promise<Blob | null> {
  if (recording.flat && args.region !== null) {
    const ppm = watchPixelsPerMm(args.region, FLAT_LIMITS);
    const picture = flattenedPicture(args.camera, frame, args.region, ppm);
    if (picture.kind === 'ok') return args.io.encodeJpeg(picture.image, TIMELAPSE_MAX_SIDE_PX);
    if (recording.timelapse.frames.length > 0) return null;
    recording.flat = false;
  }
  return args.io.encodeJpeg(frame, TIMELAPSE_MAX_SIDE_PX);
}
