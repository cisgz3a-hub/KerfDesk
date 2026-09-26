import { describe, expect, it } from 'vitest';
import type { ColoredPath } from '../scene';
import { traceImageToColoredPaths } from './trace-to-paths';
import {
  canvas,
  coverageStats,
  covers,
  fillDisc,
  lightness,
  OPTIONS,
  polygonArea,
  render,
  rgbImage,
  trace,
} from './colour-layer-trace.test-support';

describe('colour-layer trace', () => {
  it('traces red/green/blue rectangles on white as three single-subpath layers', () => {
    const paths = trace(rgbImage());
    expect(paths).toHaveLength(3);
    for (const path of paths) {
      expect(path.polylines).toHaveLength(1);
      expect(path.curves).toHaveLength(1);
      // Rectangles stay rectangles: straight line segments only.
      expect(path.curves?.[0]?.segments.every((segment) => segment.kind === 'line')).toBe(true);
    }
    expect(new Set(paths.map((p) => p.color)).size).toBe(3);
  });

  it('shares every boundary exactly: zero gap and zero overlap', () => {
    const image = rgbImage();
    const paths = trace(image);
    const { counts } = coverageStats(paths, image.width, image.height);
    let overlap = 0;
    let gap = 0;
    let s = 0;
    for (let sy = 0; sy < image.height * 4; sy += 1) {
      for (let sx = 0; sx < image.width * 4; sx += 1) {
        const x = sx / 4;
        const y = sy / 4;
        const inArt = x >= 10 && x < 50 && y >= 8 && y < 32;
        const c = counts[s] as number;
        if (c > 1) overlap += 1;
        if (inArt && c === 0) gap += 1;
        if (!inArt && c > 0) gap += 1;
        s += 1;
      }
    }
    expect(overlap).toBe(0);
    expect(gap).toBe(0);
  });

  it('keeps a two-colour logo with holes (ring with counter, dot in the counter)', () => {
    const image = canvas(80, 80, [250, 250, 250]);
    fillDisc(image, 40, 40, 30, [20, 20, 120]);
    fillDisc(image, 40, 40, 18, [250, 250, 250]);
    fillDisc(image, 40, 40, 8, [230, 120, 20]);
    const paths = trace(image);
    expect(paths).toHaveLength(2);
    const [orange, navy] = [...paths].sort((a, b) => lightness(b.color) - lightness(a.color));
    expect(navy?.polylines).toHaveLength(2); // outer ring + counter
    expect(orange?.polylines).toHaveLength(1);
    // The counter stays paper: the centre ring gap is covered by neither.
    expect(covers(navy as ColoredPath, { x: 40.3, y: 27.7 })).toBe(false);
    expect(covers(orange as ColoredPath, { x: 40.3, y: 27.7 })).toBe(false);
    expect(covers(navy as ColoredPath, { x: 40.3, y: 15.3 })).toBe(true);
    expect(covers(orange as ColoredPath, { x: 40.3, y: 40.2 })).toBe(true);
  });

  it('places anti-aliased edges sub-pixel and still shares them exactly', () => {
    // Fractional edges: red [10.25, 30.5) x [8.25, 20.5), green [30.5, 50.75)
    // over the same rows, blue [10.25, 50.75) x [20.5, 32.25).
    const image = render(60, 40, (x, y) => {
      if (x < 10.25 || x >= 50.75 || y < 8.25 || y >= 32.25) return [255, 255, 255];
      if (y >= 20.5) return [30, 50, 200];
      return x < 30.5 ? [220, 30, 30] : [30, 160, 40];
    });
    const paths = trace(image);
    expect(paths).toHaveLength(3);
    for (const path of paths) expect(path.polylines).toHaveLength(1);
    const areas = paths.map(polygonArea).sort((a, b) => a - b);
    const expected = [20.25 * 12.25, 20.25 * 12.25, 40.5 * 11.75].sort((a, b) => a - b);
    areas.forEach((area, i) => expect(Math.abs(area - (expected[i] as number))).toBeLessThan(1));
    const { counts } = coverageStats(paths, image.width, image.height);
    expect(counts.every((c) => c <= 1)).toBe(true);
  });

  it('keeps an anti-aliased disc round and true to its area', () => {
    const image = render(64, 64, (x, y) =>
      Math.hypot(x - 32, y - 32) <= 20 ? [200, 40, 40] : [255, 255, 255],
    );
    const [disc] = trace(image);
    expect(disc?.polylines).toHaveLength(1);
    const area = polygonArea(disc as ColoredPath);
    expect(Math.abs(area / (Math.PI * 400) - 1)).toBeLessThan(0.01);
    expect(disc?.curves?.[0]?.segments.some((segment) => segment.kind === 'cubic')).toBe(true);
  });

  it('stacked output covers every darker colour above it', () => {
    const image = rgbImage();
    const stacked = trace(image, { ...OPTIONS, colourLayers: { output: 'stacked' } });
    expect(stacked).toHaveLength(3);
    // Lightest first: the bottom layer spans all three rectangles in one outline.
    expect(stacked[0]?.polylines).toHaveLength(1);
    const { perPath } = coverageStats(stacked, image.width, image.height);
    const area = (mask: Uint8Array): number => mask.reduce((sum, v) => sum + v, 0) / 16;
    expect(area(perPath[0] as Uint8Array)).toBeCloseTo(40 * 24, 5);
  });

  it('is deterministic and routes through the public entry point', async () => {
    const image = rgbImage();
    const a = await traceImageToColoredPaths(image, OPTIONS);
    const b = await traceImageToColoredPaths(image, OPTIONS);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });
});
