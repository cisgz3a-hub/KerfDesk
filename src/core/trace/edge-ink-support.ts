// Filled ink-support bitmap for Edge Detection apex snapping.
//
// Apex reconstruction (potrace-apex.ts snapCornersToInk) only moves a corner
// vertex OUTWARD when the outward side has INK SUPPORT — the "is the body of
// the shape on the inward side?" guard that keeps it from pushing smooth curves
// or wrong-side corners. That guard needs a FILLED silhouette bitmap. Edge's
// own InkMask is the Canny EDGE MAP (thin 1-px lines), so using it as support
// would reject every outward move (a step just inside the tip lands off the
// hairline edge, reading as background). We therefore build the support bitmap
// straight from the SOURCE image luma: ink = luma < INK_LUMA_MAX, the same
// 0.299/0.587/0.114 luma + threshold the rest of the trace stack uses. Fully
// transparent pixels are paper regardless of their hidden RGB — exporters write
// black under alpha=0, and without this guard a transparent-background source
// would read as one canvas-sized ink blob and validate every snap.

import type { RawImageData } from './trace-image';
import type { TraceBitmap } from './potrace-bitmap';

// Luma at or above this is paper; below it is ink. Matches trace-centerline.ts
// and potrace-bitmap's default threshold (128).
const INK_LUMA_MAX = 128;

// ITU-R BT.601 luma weights, shared across the trace stack (potrace-bitmap.ts,
// trace-centerline.ts, preprocess.ts).
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

/**
 * Build a FILLED ink-support bitmap from a source image's luma, for the outward
 * ink-support guard in {@link snapCornersToInk}. A pixel is ink (`1`) when it is
 * opaque and darker than {@link INK_LUMA_MAX}; transparent pixels are paper.
 */
export function filledInkSupportBitmap(image: RawImageData): TraceBitmap {
  const { width, height, data } = image;
  const support = new Uint8Array(width * height);
  for (let pixel = 0; pixel < support.length; pixel += 1) {
    const offset = pixel * 4;
    if ((data[offset + 3] ?? 255) === 0) continue;
    const r = data[offset] ?? 255;
    const g = data[offset + 1] ?? 255;
    const b = data[offset + 2] ?? 255;
    const luma = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    support[pixel] = luma < INK_LUMA_MAX ? 1 : 0;
  }
  return { width, height, data: support };
}
