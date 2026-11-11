// The camera overlay's pictures from a bridge camera (ADR-440 Amendment 10,
// rolling audit v13 Y4-P1-2). The overlay used to sample an MJPEG <img> about
// 30 times a second and upload it whole to WebGL each time, changed or not: a
// 4K RTSP camera held the UI thread 97 % of a job, the window route's stream
// stalled for seconds with the beam lit, and Abort waited 65-83 ms.
//
// Instead the stream (or each polled JPEG) is read with fetch, and each new
// picture is decoded by createImageBitmap from its bytes, which browsers do
// off the UI thread, already shrunk to what the canvas shows. The overlay
// then uploads that small bitmap once per new picture. One decode runs at a
// time; parts that arrive meanwhile are dropped but the newest, and while a
// job runs pictures are taken at most every JOB_FRAME_MS.
//
// ADR-440 Amendment 11 (rolling audit v14 Z1-P1-1): Chromium decodes off the
// UI thread but shrinks a picture on the thread that receives the bitmap, so
// in the window a 4K picture's shrink to 1,920 px held the UI thread 118-243
// ms, during a job too. The shrink now runs in the camera picture worker,
// which hands the bitmap back. Without that worker the picture is decoded at
// full size and the GPU scales it; nothing is ever shrunk in the window. A
// shrink that would save under a tenth of the width is skipped.

import {
  MACHINE_JPEG_POLL_INTERVAL_MS,
  withCacheBuster,
  type ActiveCameraSource,
} from '../frame-source';
import { pictureClient } from '../picture-worker/camera-picture-client';
import { shrinkWidth } from '../picture-worker/picture-size';
import { jpegSize, MjpegPartReader } from './mjpeg-parts';

export type MachineFrame = {
  readonly bitmap: ImageBitmap;
  /** The picture's own size, which the camera model is fitted to; the bitmap may be smaller. */
  readonly width: number;
  readonly height: number;
};

export type FrameFeedOptions = {
  /** Widest the decoded bitmap needs to be, device pixels: the canvas's own width. */
  readonly displayWidth: () => number;
  /** Least time between pictures, ms: longer while a job streams. */
  readonly minIntervalMs: () => number;
  readonly onFrame: (frame: MachineFrame) => void;
  readonly onFailure?: () => void;
  readonly fetchImpl?: typeof fetch;
  readonly decode?: (blob: Blob, resizeWidth: number | undefined) => Promise<ImageBitmap>;
  readonly now?: () => number;
};

/** Pictures this often at most while idle, and while a job streams. */
export const IDLE_FRAME_MS = 100;
export const JOB_FRAME_MS = 500;

/** Start feeding the overlay from a bridge camera; returns stop. Null for a USB camera. */
export function startMachineFrameFeed(
  source: ActiveCameraSource,
  options: FrameFeedOptions,
): (() => void) | null {
  if (source.kind === 'usb') return null;
  const controller = new AbortController();
  const decoder = latestOnlyDecoder(options, controller.signal);
  if (source.kind === 'machine-rtsp') {
    void readStream(source.previewUrl, options, decoder, controller.signal);
  } else {
    pollJpeg(source.frameUrl, source.pollIntervalMs, options, decoder, controller.signal);
  }
  return () => controller.abort();
}

type Decoder = (bytes: Uint8Array<ArrayBuffer>) => void;

// Decodes one part at a time, keeping only the newest that arrives meanwhile.
function latestOnlyDecoder(options: FrameFeedOptions, signal: AbortSignal): Decoder {
  const now = options.now ?? (() => performance.now());
  const decode = options.decode ?? defaultDecode;
  let pending: Uint8Array<ArrayBuffer> | null = null;
  let busy = false;
  let lastAt = Number.NEGATIVE_INFINITY;
  const run = (): void => {
    if (busy || pending === null || signal.aborted) return;
    const wait = lastAt + options.minIntervalMs() - now();
    if (wait > 0) {
      setTimeout(run, wait);
      return;
    }
    const bytes = pending;
    pending = null;
    const size = jpegSize(bytes);
    if (size === null) return;
    busy = true;
    lastAt = now();
    decode(
      new Blob([bytes], { type: 'image/jpeg' }),
      shrinkWidth(size.width, options.displayWidth()),
    )
      .then((bitmap) => {
        if (signal.aborted) bitmap.close();
        else options.onFrame({ bitmap, ...size });
      })
      .catch(() => undefined)
      .finally(() => {
        busy = false;
        run();
      });
  };
  return (bytes) => {
    pending = bytes;
    run();
  };
}

// A plain decode is off the UI thread anywhere; a shrink only in the worker.
async function defaultDecode(blob: Blob, resizeWidth: number | undefined): Promise<ImageBitmap> {
  const client = resizeWidth === undefined ? null : pictureClient();
  if (client === null || resizeWidth === undefined) return createImageBitmap(blob);
  const reply = await client.run({ op: 'decode', blob, resizeWidth });
  return reply.kind === 'bitmap' ? reply.bitmap : createImageBitmap(blob);
}

async function readStream(
  url: string,
  options: FrameFeedOptions,
  decoder: Decoder,
  signal: AbortSignal,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, { signal, cache: 'no-store', mode: 'cors' });
    const reader = response.body?.getReader();
    if (!response.ok || reader === undefined) throw new Error('no stream');
    const parts = new MjpegPartReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const complete = parts.push(value);
      const newest = complete[complete.length - 1];
      if (newest !== undefined) decoder(newest);
    }
  } catch {
    // An abort is the overlay closing; anything else is the stream failing.
  }
  if (!signal.aborted) options.onFailure?.();
}

function pollJpeg(
  url: string,
  pollIntervalMs: number | undefined,
  options: FrameFeedOptions,
  decoder: Decoder,
  signal: AbortSignal,
): void {
  const fetchImpl = options.fetchImpl ?? fetch;
  const poll = async (): Promise<void> => {
    if (signal.aborted) return;
    try {
      const response = await fetchImpl(withCacheBuster(url), {
        signal,
        cache: 'no-store',
        mode: 'cors',
      });
      if (response.ok) decoder(new Uint8Array(await response.arrayBuffer()));
    } catch {
      // A missed poll is retried at the next one.
    }
    if (!signal.aborted)
      setTimeout(() => void poll(), pollIntervalMs ?? MACHINE_JPEG_POLL_INTERVAL_MS);
  };
  void poll();
}
