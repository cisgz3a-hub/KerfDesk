// The PRE-scanline image-mask verdict, copied verbatim from image-mask.ts as
// it stood before the per-row scanline landed. It is the oracle the parity
// suite compares against, so the comparison is against the exact behavior the
// optimization must preserve rather than a paraphrase of it. Keep it frozen:
// if the production path changes shape, this must not follow.
// Test-only helper: under src/__fixtures__ (boundary- and coverage-exempt per
// eslint.config.mjs). Pure and deterministic.

import { applyTransform, type RasterImage, type Vec2 } from '../core/scene';

export type OracleContours = ReadonlyArray<ReadonlyArray<Vec2>>;

export function referencePixelCenterInScene(
  image: RasterImage,
  x: number,
  y: number,
  width: number,
  height: number,
): Vec2 {
  const local = {
    x: image.bounds.minX + ((x + 0.5) / width) * (image.bounds.maxX - image.bounds.minX),
    y: image.bounds.minY + ((y + 0.5) / height) * (image.bounds.maxY - image.bounds.minY),
  };
  return applyTransform(local, image.transform);
}

export function referencePointInEvenOdd(point: Vec2, contours: OracleContours): boolean {
  let inside = false;
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i += 1) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      if (a === undefined || b === undefined) continue;
      if (a.y > point.y === b.y > point.y) continue;
      const x = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}
