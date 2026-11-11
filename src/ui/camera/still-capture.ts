// A held camera picture (Alt+C, Refresh picture, after a job) taken through
// the camera picture worker (ADR-440 Amendment 11, rolling audit v14
// Z1-P2-2). In the window a 4K still's decode to pixels held the UI thread
// 76-251 ms and its full-size upload to the overlay another 131 ms, so an
// Alt+C during a job delayed Abort and stopped a window-route stream lit.
//
// The worker reads the pixels (which the still's other users keep needing),
// a copy shrunk for the overlay, and the moved check's thumbnail; all three
// come back without a copy. The copy and the thumbnail travel beside the
// pixels, so the camera store and every caller keep the picture they had.
// Without the worker, or when it fails, the picture is taken in the window
// as before.

import type { ViewThumbnail } from '../../core/camera/model/view-shift';
import type { RgbaImage } from '../../core/camera/rgba-image';
import { captureSourceFrame, type ActiveCameraSource } from './frame-source';
import { pictureClient, type PictureClient } from './picture-worker/camera-picture-client';
import { OVERLAY_MAX_WIDTH } from './picture-worker/picture-size';

/** What the worker made beside a held picture's pixels. */
export type StillCompanion = {
  /** The picture shrunk for the overlay to draw. */
  readonly display: ImageBitmap | null;
  /** The moved check's thumbnail of the picture. */
  readonly thumbnail: ViewThumbnail | null;
};

const companions = new WeakMap<RgbaImage, StillCompanion>();

export function stillCompanion(image: RgbaImage): StillCompanion | undefined {
  return companions.get(image);
}

export type StillCaptureDeps = {
  readonly client?: PictureClient | null;
  /** Width of the moved check's thumbnail, or null when no view reference is kept. */
  readonly thumbWidth?: number | null;
  readonly inWindow?: typeof captureSourceFrame;
};

/** One full-resolution picture of `source`, its pixels read off the UI thread where possible. */
export async function captureStill(
  source: ActiveCameraSource,
  deps: StillCaptureDeps = {},
): Promise<RgbaImage | null> {
  const client = deps.client === undefined ? pictureClient() : deps.client;
  const inWindow = deps.inWindow ?? captureSourceFrame;
  if (client === null) return inWindow(source);
  const frame = await client.capture(source);
  if (frame === null) return null;
  const reply = await client.run({
    op: 'still',
    frame,
    pixels: true,
    displayWidth: OVERLAY_MAX_WIDTH,
    thumbWidth: deps.thumbWidth ?? null,
  });
  if (reply.kind !== 'still' || reply.image === null) return inWindow(source);
  companions.set(reply.image, { display: reply.display, thumbnail: reply.thumbnail });
  return reply.image;
}
