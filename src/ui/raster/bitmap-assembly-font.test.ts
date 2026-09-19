import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { textToPolylines } from '../../core/text/text-to-polylines';
import {
  IDENTITY_TRANSFORM,
  flattenColoredPathCurves,
  type Polyline,
  type TextObject,
  type Vec2,
} from '../../core/scene';
import type { VectorRaster } from '../../core/raster';
import { assembleBitmap } from './bitmap-assembly';

it('retains overlap ink in the shipped Dancing Script font without requiring text welding', async () => {
  const bytes = readFileSync(resolve(__dirname, '../text/fonts/DancingScript-Regular.ttf'));
  const rendered = await textToPolylines({
    fontBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    content: 'my',
    sizeMm: 40,
    alignment: 'left',
    lineHeight: 1.4,
    color: '#000000',
  });
  const object: TextObject = {
    kind: 'text',
    id: 'script',
    content: 'my',
    fontKey: 'dancing-script',
    sizeMm: 40,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#000000',
    weldOverlaps: false,
    transform: IDENTITY_TRANSFORM,
    ...rendered,
  };
  const contours = rendered.paths.flatMap((path) => {
    const result = flattenColoredPathCurves(path, { toleranceMm: 0.0025 });
    if (result.kind !== 'ok') throw new Error('Reference font flattening failed');
    return result.polylines;
  });
  let captured: VectorRaster | undefined;
  const image = assembleBitmap(
    [object],
    (raster) => {
      captured = raster;
      return { dataUrl: 'data:,', lumaBase64: '' };
    },
    'bitmap',
    { dpi: 254 },
  );
  if (captured === undefined) throw new Error('Expected raster');
  const raster = captured;
  let checked = 0;
  for (let y = 0; y < raster.height; y += 3) {
    for (let x = 0; x < raster.width; x += 3) {
      const point = {
        x: image.bounds.minX + ((x + 0.5) * (image.bounds.maxX - image.bounds.minX)) / raster.width,
        y:
          image.bounds.minY + ((y + 0.5) * (image.bounds.maxY - image.bounds.minY)) / raster.height,
      };
      const reference = windingAndDistance(point, contours);
      // Check only overlap interiors farther than half a pixel from any
      // boundary, twice the conversion's curve-flattening tolerance.
      if (Math.abs(reference.winding) < 2 || reference.distanceSq <= 0.05 ** 2) continue;
      expect(raster.luma[y * raster.width + x]).toBe(127);
      checked += 1;
    }
  }
  expect(checked).toBeGreaterThan(0);
});

function windingAndDistance(point: Vec2, contours: ReadonlyArray<Polyline>) {
  let winding = 0;
  let distanceSq = Infinity;
  for (const contour of contours) {
    for (let index = 0; index < contour.points.length; index += 1) {
      const a = contour.points[index];
      const b = contour.points[(index + 1) % contour.points.length];
      if (a === undefined || b === undefined) continue;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const cross = dx * (point.y - a.y) - dy * (point.x - a.x);
      if (a.y <= point.y && b.y > point.y && cross > 0) winding += 1;
      if (a.y > point.y && b.y <= point.y && cross < 0) winding -= 1;
      const denominator = dx * dx + dy * dy;
      const t =
        denominator === 0
          ? 0
          : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator));
      distanceSq = Math.min(
        distanceSq,
        (point.x - a.x - t * dx) ** 2 + (point.y - a.y - t * dy) ** 2,
      );
    }
  }
  return { winding, distanceSq };
}
