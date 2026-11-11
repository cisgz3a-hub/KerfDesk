// The camera-moved check on a camera that has just started or been switched
// to (ADR-663 Amendment 6, rolling audit v14 Z1-P2-1). Opening the Camera
// panel during a job starts the remembered camera, so this ran mid-job: its
// picture's decode held the UI thread 76-141 ms at 4K and the thumbnail
// another 47-119 ms, and the comparison 185-290 ms. The picture is now read
// and thumbnailed in the camera picture worker, and the thumbnails compared
// there; only the small thumbnail and the verdict come back. Nothing is taken
// when the camera has no view reference to compare with. Without the worker,
// or when it fails, the work is done in the window as before.

import { captureSourceFrame, type ActiveCameraSource } from '../frame-source';
import { pictureClient, type PictureClient } from '../picture-worker/camera-picture-client';
import {
  checkCameraMovedInWorker,
  checkCameraMovedView,
  movedCheckThumbWidth,
  rgbaView,
  type FrameView,
} from './moved-check';

export type MovedCaptureDeps = {
  readonly client?: PictureClient | null;
  readonly inWindow?: typeof captureSourceFrame;
};

/** Check whether the camera `source` has moved, from a new picture of it. */
export async function checkStartedCameraMoved(
  source: ActiveCameraSource,
  deps: MovedCaptureDeps = {},
): Promise<void> {
  const thumbWidth = movedCheckThumbWidth(source);
  if (thumbWidth === null) {
    checkCameraMovedView(source, null);
    return;
  }
  const view = await captureMovedView(source, thumbWidth, deps);
  const client = deps.client === undefined ? pictureClient() : deps.client;
  if (view !== null) await checkCameraMovedInWorker(source, view, client);
}

async function captureMovedView(
  source: ActiveCameraSource,
  thumbWidth: number,
  deps: MovedCaptureDeps,
): Promise<FrameView | null> {
  const client = deps.client === undefined ? pictureClient() : deps.client;
  const inWindow = deps.inWindow ?? captureSourceFrame;
  if (client !== null) {
    const frame = await client.capture(source);
    if (frame === null) return null;
    const reply = await client.run({
      op: 'still',
      frame,
      pixels: false,
      displayWidth: null,
      thumbWidth,
    });
    if (reply.kind === 'still' && reply.thumbnail !== null) {
      const { width, height, thumbnail } = reply;
      // Only the reference's width is ever asked for.
      return { width, height, thumbnail: () => thumbnail };
    }
  }
  const frame = await inWindow(source);
  return frame === null ? null : rgbaView(frame);
}
