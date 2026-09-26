import { describe, expect, it } from 'vitest';
import type { ColoredPath, Polyline } from '../scene';
import { HYBRID_STROKE_COLOR } from './hybrid/hybrid-paths';
import { enhanceRegionPaths, replacePathsInRegion } from './region-enhance';
import type { RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

function stroke(x: number, y: number, width: number): ColoredPath {
  const polyline: Polyline = {
    closed: false,
    points: [
      { x, y },
      { x: 30, y },
    ],
  };
  return { color: HYBRID_STROKE_COLOR, strokeWidthMm: width, polylines: [polyline] };
}

describe('Line + fill region border correspondence', () => {
  const interior = { x: 10, y: 10, width: 40, height: 40 };

  it('keeps the accepted replacement width when its new endpoint crosses outside the border', () => {
    const original = stroke(10.2, 20, 3);
    const replacement = stroke(9.7, 20, 3.125);
    expect(replacePathsInRegion([original], interior, [replacement])).toEqual([replacement]);
  });

  it('keeps a crossing original once when its new endpoint moves inside the border', () => {
    const original = stroke(9.8, 20, 3);
    const replacement = stroke(10.3, 20, 2.875);
    const result = replacePathsInRegion([original], interior, [replacement]);
    expect(result).toEqual([original]);
    expect(result[0]).toBe(original);
  });

  it('pairs adjacent same-colour strokes one-to-one without merging their width groups', () => {
    const crossing = stroke(9.8, 20, 3);
    const inside = stroke(10.2, 20.6, 2);
    const crossingReplacement = stroke(10.1, 20, 3.125);
    const insideReplacement = stroke(9.9, 20.6, 1.875);
    expect(
      replacePathsInRegion([crossing, inside], interior, [insideReplacement, crossingReplacement]),
    ).toEqual([crossing, insideReplacement]);
  });

  it('does not match a closed measured stroke to an unstroked fill of the same colour', () => {
    const ring = {
      color: '#123456',
      strokeWidthMm: 2,
      polylines: [
        {
          closed: true,
          points: [
            { x: 9.8, y: 20 },
            { x: 30, y: 20 },
            { x: 30, y: 30 },
            { x: 9.8, y: 30 },
          ],
        },
      ],
    };
    const fill = {
      color: ring.color,
      polylines: [
        {
          closed: true,
          points: [
            { x: 10.3, y: 20 },
            { x: 30, y: 20 },
            { x: 30, y: 30 },
            { x: 10.3, y: 30 },
          ],
        },
      ],
    };
    expect(replacePathsInRegion([ring], interior, [fill])).toEqual([ring, fill]);
  });

  it('keeps different pen transforms apart even when the stroke bounds match', () => {
    const original = {
      ...stroke(9.8, 20, 3),
      strokeTransform: { a: 1, b: 0, c: 0, d: 2 },
    };
    const replacement = {
      ...stroke(10.3, 20, 3.125),
      strokeTransform: { a: 2, b: 0, c: 0, d: 1 },
    };
    expect(replacePathsInRegion([original], interior, [replacement])).toEqual([
      original,
      replacement,
    ]);
  });
});

// A 2 px pen at 15 degrees, plus a separate wide block. The full image runs
// at native resolution; Enhance traces its padded crop at 2x. The pen's
// measured width changes from 2 to 1.875 source pixels, so exact width is not
// an identity for the same physical mark on the two grids.
function lineAndBlock(): RawImageData {
  const width = 160;
  const height = 160;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const dx = 80 * Math.cos(Math.PI / 12);
  const dy = 80 * Math.sin(Math.PI / 12);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = Math.max(0, Math.min(1, ((x + 0.5 - 20) * dx + (y + 0.5 - 20) * dy) / 6400));
      const pen = Math.hypot(x + 0.5 - 20 - t * dx, y + 0.5 - 20 - t * dy) < 1;
      const block = x >= 20 && x < 130 && y >= 120 && y < 155;
      if (pen || block) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  }
  return { width, height, data };
}

function strokes(paths: ReadonlyArray<ColoredPath>): ReadonlyArray<ColoredPath> {
  return paths.filter((path) => path.color === HYBRID_STROKE_COLOR);
}

describe('real Line + fill Enhance region', () => {
  it.each([
    {
      label: 'keeps a crossing original without a duplicate',
      region: { x: 18, y: 10, width: 97, height: 105 },
      expectedWidth: 2,
    },
    {
      label: 'keeps an accepted replacement without deleting the stroke',
      region: { x: 10, y: 19, width: 105, height: 96 },
      expectedWidth: 1.875,
    },
  ])('$label', async ({ region, expectedWidth }) => {
    const image = lineAndBlock();
    const options = { ...TRACE_PRESETS['Line + fill'], hybridMaxStrokeWidthPx: 4 };
    const fullTracePaths = await traceImageToColoredPaths(image, options);
    const originalStrokes = strokes(fullTracePaths);
    expect(originalStrokes).toHaveLength(1);
    expect(originalStrokes[0]?.strokeWidthMm).toBe(2);
    expect(originalStrokes[0]?.polylines).toHaveLength(1);

    const result = await enhanceRegionPaths({
      image,
      region,
      options,
      fullTracePaths,
      trace: traceImageToColoredPaths,
    });
    const resultStrokes = strokes(result);
    expect(resultStrokes.flatMap((path) => path.polylines)).toHaveLength(1);
    expect(resultStrokes[0]?.strokeWidthMm).toBe(expectedWidth);
    expect(resultStrokes[0]?.curves).toHaveLength(1);
    // The block outside the enhanced region keeps its exact original data.
    const originalFill = fullTracePaths.find((path) => path.color !== HYBRID_STROKE_COLOR);
    expect(originalFill).toBeDefined();
    expect(result.find((path) => path.color !== HYBRID_STROKE_COLOR)).toBe(originalFill);
  });
});
