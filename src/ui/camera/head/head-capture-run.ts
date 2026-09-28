// Moving a head camera over an area and taking its pictures (ADR-449), like
// LightBurn's head-camera Update Overlay: jog to a stop, wait until the head
// is at rest there, take a picture, repeat. The moves are ordinary beam-off
// jogs; nothing here fires the laser. The run ends at the first problem or
// when the operator presses Stop, and keeps the pictures already taken.

import type { HeadCameraPicture } from '../../../core/camera/model/head-camera-stitch';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import type { Vec2 } from '../../../core/scene';

export type HeadSettle =
  | { readonly kind: 'settled'; readonly headMm: Vec2 }
  | { readonly kind: 'failed'; readonly message: string };

export type HeadCaptureIo = {
  /** Start the beam-off move to `head` (scene mm). */
  readonly moveTo: (head: Vec2) => Promise<void>;
  /** Resolves once the head is at rest at `head`, with where it measured, or why not. */
  readonly settleAt: (head: Vec2) => Promise<HeadSettle>;
  /** A picture taken after the head came to rest, or null when none came. */
  readonly takePicture: () => Promise<RgbaImage | null>;
  readonly stopRequested: () => boolean;
  readonly onProgress: (taken: number, total: number) => void;
};

export type HeadCaptureOutcome =
  | { readonly kind: 'done'; readonly pictures: ReadonlyArray<HeadCameraPicture> }
  | { readonly kind: 'stopped'; readonly pictures: ReadonlyArray<HeadCameraPicture> }
  | {
      readonly kind: 'failed';
      readonly message: string;
      readonly pictures: ReadonlyArray<HeadCameraPicture>;
    };

export const NO_PICTURE_MESSAGE =
  'The camera did not send a picture. Check that it is running, then capture again.';

export async function runHeadCapture(
  stops: ReadonlyArray<Vec2>,
  io: HeadCaptureIo,
): Promise<HeadCaptureOutcome> {
  const pictures: HeadCameraPicture[] = [];
  for (const [index, stop] of stops.entries()) {
    if (io.stopRequested()) return { kind: 'stopped', pictures };
    try {
      await io.moveTo(stop);
    } catch (error: unknown) {
      return { kind: 'failed', message: errorMessage(error), pictures };
    }
    const settled = await io.settleAt(stop);
    if (settled.kind === 'failed') return { kind: 'failed', message: settled.message, pictures };
    if (io.stopRequested()) return { kind: 'stopped', pictures };
    const frame = await io.takePicture();
    if (frame === null) return { kind: 'failed', message: NO_PICTURE_MESSAGE, pictures };
    pictures.push({ frame, headMm: settled.headMm });
    io.onProgress(index + 1, stops.length);
  }
  return { kind: 'done', pictures };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : 'The head could not be moved.';
}
