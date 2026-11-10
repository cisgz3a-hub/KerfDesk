// The UI thread's side of the camera picture worker (ADR-490 Amendment 2).
// A frame reaches the worker as an ImageBitmap, transferred without a copy:
// for a bridge camera it is made by createImageBitmap from the fetched JPEG,
// which browsers decode off the UI thread; for a USB camera from its video.
// The UI thread then only posts the bitmap and waits. One worker serves every
// request in turn; where workers or OffscreenCanvas are missing, there is no
// client and callers keep their in-window path.

import type { ActiveCameraSource } from '../frame-source';
import { withCacheBuster } from '../frame-source';
import { STREAM_FRAME_TIMEOUT_MS } from '../frame-capture';
import type { PictureReply, PictureRequest } from './picture-work';

export type PictureClient = {
  /** One frame of `source` as a bitmap, or null when none came. */
  readonly capture: (source: ActiveCameraSource) => Promise<ImageBitmap | null>;
  readonly run: (request: PictureRequest) => Promise<PictureReply>;
};

let shared: PictureClient | null | undefined;

/** The shared client, or null where pictures cannot be worked off the UI thread. */
export function pictureClient(): PictureClient | null {
  if (shared !== undefined) return shared;
  const supported =
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap !== 'undefined';
  shared = supported ? createPictureClient() : null;
  return shared;
}

function createPictureClient(): PictureClient {
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, (reply: PictureReply) => void>();
  const failAll = (): void => {
    for (const resolve of pending.values()) resolve({ kind: 'failed' });
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  const ensure = (): Worker => {
    if (worker !== null) return worker;
    const created = new Worker(new URL('./camera-picture-worker.ts', import.meta.url), {
      type: 'module',
    });
    created.onmessage = (event: MessageEvent<{ id: number; reply: PictureReply }>) => {
      const resolve = pending.get(event.data.id);
      pending.delete(event.data.id);
      resolve?.(event.data.reply);
    };
    created.onerror = failAll;
    created.onmessageerror = failAll;
    worker = created;
    return created;
  };
  return {
    capture: captureSourceBitmap,
    run: (request) =>
      new Promise<PictureReply>((resolve) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, resolve);
        ensure().postMessage({ id, request }, [request.frame]);
      }),
  };
}

/** One frame of `source` as a bitmap, decoded off the UI thread where the browser can. */
export async function captureSourceBitmap(source: ActiveCameraSource): Promise<ImageBitmap | null> {
  try {
    if (source.kind === 'usb') return await streamBitmap(source.stream.stream);
    const url = source.kind === 'machine-jpeg' ? withCacheBuster(source.frameUrl) : source.frameUrl;
    const response = await fetch(url);
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch {
    return null;
  }
}

function streamBitmap(stream: MediaStream): Promise<ImageBitmap | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    const done = (bitmap: ImageBitmap | null): void => {
      if (settled) {
        bitmap?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      video.onloadeddata = null;
      video.srcObject = null;
      resolve(bitmap);
    };
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      createImageBitmap(video).then(done, () => done(null));
    };
    video.onerror = () => done(null);
    const timer = setTimeout(() => done(null), STREAM_FRAME_TIMEOUT_MS);
    video.srcObject = stream;
    void video.play().catch(() => done(null));
  });
}
