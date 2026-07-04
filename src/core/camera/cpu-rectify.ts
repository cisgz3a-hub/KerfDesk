// CPU de-fisheye (ADR-108, v2.d) — the WebGL-free fallback and the verifiable
// reference the GPU shader mirrors. For each rectified output pixel it reads the
// source pixel given by the rectify map and bilinearly samples it. Pure core:
// operates on RGBA byte buffers, no canvas or DOM. Out-of-frame samples are
// transparent so the rectified field shows its real (smaller) valid region.

import type { CameraIntrinsics, FisheyeDistortion } from './fisheye';
import { rectifySamplePoint } from './rectify-map';

/** A row-major RGBA8 image buffer (4 bytes per pixel). */
export type RgbaImage = {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
};

/** The rectified output frame and the calibrated camera it was captured with. */
export type RectifyTarget = {
  readonly width: number;
  readonly height: number;
  readonly outputK: CameraIntrinsics;
  readonly sourceK: CameraIntrinsics;
  readonly distortion: FisheyeDistortion;
};

/** Rectify (de-fisheye) `source` into a new output buffer of `target` dimensions. */
export function rectifyImage(source: RgbaImage, target: RectifyTarget): RgbaImage {
  const data = new Uint8ClampedArray(target.width * target.height * 4);
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const sample = rectifySamplePoint(
        { x, y },
        target.outputK,
        target.sourceK,
        target.distortion,
      );
      writeBilinear(data, (y * target.width + x) * 4, source, sample.x, sample.y);
    }
  }
  return { data, width: target.width, height: target.height };
}

// Sample `source` at the fractional (sx, sy) and write the RGBA into `out` at
// `offset`. The valid region is the convex hull of pixel centres [0, w-1]x[0, h-1];
// outside it the output pixel is transparent. On the far edge the high bilinear tap
// is clamped to the last index (its weight is 0 there) so the boundary has no seam.
// Exported for the bed warp (warp-to-bed.ts), which shares the sampling rules.
export function writeBilinear(
  out: Uint8ClampedArray,
  offset: number,
  source: RgbaImage,
  sx: number,
  sy: number,
): void {
  if (sx < 0 || sy < 0 || sx > source.width - 1 || sy > source.height - 1) {
    out[offset] = 0;
    out[offset + 1] = 0;
    out[offset + 2] = 0;
    out[offset + 3] = 0;
    return;
  }
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, source.width - 1);
  const y1 = Math.min(y0 + 1, source.height - 1);
  const tx = sx - x0;
  const ty = sy - y0;
  for (let channel = 0; channel < 4; channel += 1) {
    out[offset + channel] = bilinearChannel(source, x0, y0, x1, y1, tx, ty, channel);
  }
}

function bilinearChannel(
  source: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tx: number,
  ty: number,
  channel: number,
): number {
  const topLeft = channelAt(source, x0, y0, channel);
  const topRight = channelAt(source, x1, y0, channel);
  const bottomLeft = channelAt(source, x0, y1, channel);
  const bottomRight = channelAt(source, x1, y1, channel);
  const top = topLeft + (topRight - topLeft) * tx;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * tx;
  return top + (bottom - top) * ty;
}

function channelAt(source: RgbaImage, x: number, y: number, channel: number): number {
  return source.data[(y * source.width + x) * 4 + channel] ?? 0;
}
