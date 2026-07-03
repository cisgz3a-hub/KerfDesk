// Top-down bed warp (ADR-110, camera v4): resample a camera frame into bed
// millimetre space through the aligned homography, producing the registered
// image capture-to-trace feeds the trace pipeline. Output→input sampling: for
// each bed-space output pixel, the INVERSE homography gives the camera pixel
// to read (bilinear; off-frame pixels stay transparent). Pure core.

import type { Mat3 } from './homography';
import { invertMat3 } from './mat3';
import { type RgbaImage, writeBilinear } from './cpu-rectify';

export type BedWarpOptions = {
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  // Output resolution. 4 px/mm ≈ 102 dpi is plenty for tracing outlines.
  readonly pixelsPerMm: number;
  // Camera-pixel → bed-mm homography, in the FRAME's pixel basis.
  readonly homography: Mat3;
};

export type BedWarpResult =
  | { readonly kind: 'ok'; readonly image: RgbaImage }
  | { readonly kind: 'failed'; readonly reason: 'singular-homography' | 'bad-dimensions' };

/** Warp `frame` into a top-down bed image at `pixelsPerMm`. */
export function warpFrameToBed(frame: RgbaImage, options: BedWarpOptions): BedWarpResult {
  const width = Math.round(options.bedWidthMm * options.pixelsPerMm);
  const height = Math.round(options.bedHeightMm * options.pixelsPerMm);
  if (width <= 0 || height <= 0) return { kind: 'failed', reason: 'bad-dimensions' };
  const bedToCamera = invertMat3(options.homography);
  if (bedToCamera === null) return { kind: 'failed', reason: 'singular-homography' };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const bedY = (y + 0.5) / options.pixelsPerMm;
    for (let x = 0; x < width; x += 1) {
      const bedX = (x + 0.5) / options.pixelsPerMm;
      const w = bedToCamera[6] * bedX + bedToCamera[7] * bedY + bedToCamera[8];
      const offset = (y * width + x) * 4;
      if (Math.abs(w) < 1e-12) continue; // stays transparent
      const sx = (bedToCamera[0] * bedX + bedToCamera[1] * bedY + bedToCamera[2]) / w;
      const sy = (bedToCamera[3] * bedX + bedToCamera[4] * bedY + bedToCamera[5]) / w;
      writeBilinear(data, offset, frame, sx, sy);
    }
  }
  return { kind: 'ok', image: { data, width, height } };
}
