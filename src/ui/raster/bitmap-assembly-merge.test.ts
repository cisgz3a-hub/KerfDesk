// ADR-029 amendment ii: a multi-selection converts into ONE bitmap, like
// LightBurn. Fill All is even-odd across the whole selection ("areas between
// outlines"), matching how our Fill mode hatches a layer's contours together.
// Split from vector-to-bitmap.test.ts (file line cap).

import { describe, expect, it } from 'vitest';
import type { VectorRaster } from '../../core/raster';
import {
  IDENTITY_TRANSFORM,
  transformedBBox,
  type ImportedSvg,
  type Transform,
} from '../../core/scene';
import type { BitmapFields } from './luma-bitmap';
import { assembleBitmap } from './vector-to-bitmap';

// Axis-aligned square object at a given offset; identity transform so the
// pixel math below stays readable (dpi 127 = 5 px/mm).
function squareObject(id: string, minX: number, minY: number, size: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX, minY, maxX: minX + size, maxY: minY + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: minX, y: minY },
              { x: minX + size, y: minY },
              { x: minX + size, y: minY + size },
              { x: minX, y: minY + size },
            ],
          },
        ],
      },
    ],
  };
}

function fakeEncode(raster: VectorRaster): BitmapFields {
  return {
    dataUrl: `data:fake/${raster.width}x${raster.height}`,
    lumaBase64: `luma:${raster.luma.length}`,
  };
}

describe('assembleBitmap multi-object merge', () => {
  it('spans the combined bounds of the whole selection', () => {
    // 20 mm square at origin + 20 mm square at x=30 → union 0..50 × 0..20.
    const result = assembleBitmap(
      [squareObject('a', 0, 0, 20), squareObject('b', 30, 0, 20)],
      fakeEncode,
      'merged',
      { dpi: 127 },
    );

    expect(result.bounds).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 20 });
    expect(result.pixelWidth).toBe(250); // 50 mm × 5 px/mm
    expect(result.pixelHeight).toBe(100);
  });

  it('includes rotated members via their transformed AABBs', () => {
    const rotatedTransform: Transform = {
      x: 40,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 45,
      mirrorX: false,
      mirrorY: false,
    };
    const rotated: ImportedSvg = {
      ...squareObject('rot', 0, 0, 20),
      transform: rotatedTransform,
    };
    const expected = transformedBBox(rotated);
    const result = assembleBitmap([squareObject('a', 0, 0, 20), rotated], fakeEncode, 'merged');

    expect(result.bounds.maxX).toBeCloseTo(Math.max(20, expected.maxX), 6);
    expect(result.bounds.minX).toBeCloseTo(Math.min(0, expected.minX), 6);
  });

  it('renders cross-object even-odd: a nested separate shape cuts a hole', () => {
    // A 20 mm square with a 10 mm square from ANOTHER object nested inside:
    // LightBurn's "areas between outlines" (and our Fill mode) make a donut.
    let encoded: VectorRaster | null = null;
    assembleBitmap(
      [squareObject('outer', 0, 0, 20), squareObject('inner', 5, 5, 10)],
      (raster) => {
        encoded = raster;
        return fakeEncode(raster);
      },
      'merged',
      { dpi: 127 },
    );

    expect(encoded).not.toBeNull();
    const raster = encoded as unknown as VectorRaster;
    const lumaAt = (xMm: number, yMm: number): number =>
      raster.luma[Math.round(yMm * 5) * raster.width + Math.round(xMm * 5)] ?? -1;
    expect(lumaAt(2.5, 10)).toBe(127); // ring between the squares
    expect(lumaAt(10, 10)).toBe(255); // nested square's interior = hole
  });

  it('labels a multi-object conversion by count', () => {
    const result = assembleBitmap(
      [squareObject('a', 0, 0, 20), squareObject('b', 30, 0, 20)],
      fakeEncode,
      'merged',
    );
    expect(result.source).toBe('2 objects (bitmap)');
  });
});
