import { describe, expect, it } from 'vitest';
import { traceImageToEdgePaths } from './edge-trace';
import { TRACE_PRESETS, type RawImageData } from './trace-image';

const EDGE_OPTIONS = TRACE_PRESETS['Edge Detection']!;

// A `size`x`size` RGBA image: a filled dark square in [lo, hi) on white.
function filledSquare(size: number, lo: number, hi: number): RawImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const o = (y * size + x) * 4;
      const value = x >= lo && x < hi && y >= lo && y < hi ? 0 : 255;
      data[o] = value;
      data[o + 1] = value;
      data[o + 2] = value;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

describe('traceImageToEdgePaths', () => {
  it("traces a filled square's edges as polylines spanning its boundary", () => {
    const paths = traceImageToEdgePaths(filledSquare(64, 18, 46), EDGE_OPTIONS);
    expect(paths.length).toBeGreaterThan(0);
    const points = paths.flatMap((p) => p.polylines).flatMap((pl) => pl.points);
    expect(points.length).toBeGreaterThan(0);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    // The trace hugs the square boundary at ~18 and ~46, not the interior.
    expect(Math.min(...xs)).toBeLessThan(22);
    expect(Math.max(...xs)).toBeGreaterThan(42);
    expect(Math.min(...ys)).toBeLessThan(22);
    expect(Math.max(...ys)).toBeGreaterThan(42);
  });

  it('returns no paths for a flat image (no edges)', () => {
    expect(traceImageToEdgePaths(filledSquare(32, 1, 0), EDGE_OPTIONS)).toEqual([]);
  });
});
