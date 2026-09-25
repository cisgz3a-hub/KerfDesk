// Corner dial (ADR-404): Smoothness decides which boundary turns are corners,
// on every loop, before any smoothing. s = 0 is the exact pixel polygon, the
// slider maximum has no corners, and the corner count never rises with s.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { midCrackChainWithStats, traceBoundaryLoops } from './contour-boundary';
import { cornerThresholdFromSmoothness, decideContourCorners } from './contour-corners';
import { flattenStrengthFromSmoothness } from './contour-trace';
import type { RawImageData, TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

const MARGIN = 10;

type Ink = (x: number, y: number) => boolean;

function raster(
  width: number,
  height: number,
  ink: Ink,
): { image: RawImageData; mask: Uint8Array } {
  const data = new Uint8ClampedArray(width * height * 4);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const on = ink(x, y);
      mask[y * width + x] = on ? 1 : 0;
      const value = on ? 0 : 255;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { image: { width, height, data }, mask };
}

function square(side: number) {
  const size = side + 2 * MARGIN;
  const inside = (v: number) => v >= MARGIN && v < MARGIN + side;
  return raster(size, size, (x, y) => inside(x) && inside(y));
}

function disc(radius: number) {
  const centre = radius + MARGIN + 0.37;
  const size = Math.ceil(2 * centre);
  return raster(size, size, (x, y) => Math.hypot(x + 0.5 - centre, y + 0.5 - centre) <= radius);
}

function sprite(rows: ReadonlyArray<string>, cell: number) {
  const width = (rows[0] as string).length * cell + 2 * MARGIN;
  const height = rows.length * cell + 2 * MARGIN;
  return raster(width, height, (x, y) => {
    const row = rows[Math.floor((y - MARGIN) / cell)];
    return y >= MARGIN && x >= MARGIN && row?.[Math.floor((x - MARGIN) / cell)] === '#';
  });
}

function wedge(degrees: number) {
  const half = (degrees * Math.PI) / 360;
  const length = 40;
  const apex = { x: MARGIN + 0.3, y: MARGIN + length * Math.sin(half) + 0.2 };
  const far = apex.x + length * Math.cos(half);
  const spread = length * Math.sin(half);
  const size = Math.ceil(Math.max(far, apex.y + spread) + MARGIN);
  return raster(size, size, (x, y) => {
    const px = x + 0.5 - apex.x;
    const py = Math.abs(y + 0.5 - apex.y);
    return px > 0 && px < far - apex.x && py < px * Math.tan(half);
  });
}

// Corners the dial decides on every raw loop of a binary mask at Smoothness s.
function dialCorners(width: number, height: number, mask: Uint8Array, s: number): number {
  let count = 0;
  for (const loop of traceBoundaryLoops({ width, height, ink: mask })) {
    const cracks = midCrackChainWithStats(loop.points).points;
    count += decideContourCorners({
      staircase: loop.points,
      cracks,
      measured: false,
      pixelScale: 1,
      thresholdPx: cornerThresholdFromSmoothness(s),
      edgeNoisePx: flattenStrengthFromSmoothness(s),
    }).length;
  }
  return count;
}

function rings(paths: Awaited<ReturnType<typeof traceImageToColoredPaths>>): Vec2[][] {
  return paths.flatMap((path) => path.polylines.map((polyline) => [...polyline.points]));
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function distanceToRings(p: Vec2, traced: Vec2[][]): number {
  let best = Infinity;
  for (const ring of traced) {
    for (let i = 0; i + 1 < ring.length; i += 1) {
      best = Math.min(best, segmentDistance(p, ring[i] as Vec2, ring[i + 1] as Vec2));
    }
  }
  return best;
}

// Symmetric Hausdorff distance between the traced rings and the pixel
// boundary (every crack sampled; every traced vertex tested).
function pixelBoundaryDistance(traced: Vec2[][], width: number, height: number, mask: Uint8Array) {
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  const cracks: [Vec2, Vec2][] = [];
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      if (at(x, y) !== at(x - 1, y))
        cracks.push([
          { x, y },
          { x, y: y + 1 },
        ]);
      if (at(x, y) !== at(x, y - 1))
        cracks.push([
          { x, y },
          { x: x + 1, y },
        ]);
    }
  }
  let worst = 0;
  for (const [a, b] of cracks) {
    for (let k = 0; k <= 4; k += 1) {
      const p = { x: a.x + ((b.x - a.x) * k) / 4, y: a.y + ((b.y - a.y) * k) / 4 };
      worst = Math.max(worst, distanceToRings(p, traced));
    }
  }
  for (const ring of traced) {
    for (const p of ring) {
      let best = Infinity;
      for (const [a, b] of cracks) best = Math.min(best, segmentDistance(p, a, b));
      worst = Math.max(worst, best);
    }
  }
  return worst;
}

describe('corner dial', () => {
  it('maps Smoothness onto a rising threshold from the pixel polygon to no corners', () => {
    expect(cornerThresholdFromSmoothness(0)).toBe(0);
    expect(cornerThresholdFromSmoothness(4 / 3)).toBe(Infinity);
    let previous = -1;
    for (let s = 0; s <= 1.33; s += 0.01) {
      const threshold = cornerThresholdFromSmoothness(s);
      expect(threshold).toBeGreaterThanOrEqual(previous);
      previous = threshold;
    }
  });

  it('never adds a corner as Smoothness rises', () => {
    const shapes = [
      square(6),
      square(32),
      disc(12),
      disc(40),
      wedge(30),
      wedge(120),
      sprite(['##..', '##..', '####', '####'], 3),
    ];
    for (const { image, mask } of shapes) {
      let previous = Infinity;
      for (let k = 0; k <= 133; k += 3) {
        const count = dialCorners(image.width, image.height, mask, k / 100);
        expect(count).toBeLessThanOrEqual(previous);
        previous = count;
      }
      expect(dialCorners(image.width, image.height, mask, 1.33)).toBe(0);
    }
  });

  it('keeps every pixel turn at Smoothness 0 and none at the maximum', () => {
    const { image, mask } = disc(8);
    const turns = dialCorners(image.width, image.height, mask, 0);
    expect(turns).toBeGreaterThan(20);
    expect(dialCorners(image.width, image.height, mask, 4 / 3)).toBe(0);
  });

  it('finds no corner on digitized circles at the default Smoothness', () => {
    for (const radius of [4, 6, 8, 12, 20, 40, 60]) {
      const { image, mask } = disc(radius);
      expect(dialCorners(image.width, image.height, mask, 1), `r=${radius}`).toBe(0);
    }
  });
});

describe('pixel-exact corners through the whole trace', () => {
  it('traces binary squares from 8 px up with exact right-angle apexes at Line Art', async () => {
    for (const side of [8, 12, 16, 32, 64, 120]) {
      const { image } = square(side);
      const traced = rings(await traceImageToColoredPaths(image, TRACE_PRESETS['Line Art']!));
      const apexes = [
        { x: MARGIN, y: MARGIN },
        { x: MARGIN + side, y: MARGIN },
        { x: MARGIN + side, y: MARGIN + side },
        { x: MARGIN, y: MARGIN + side },
      ];
      for (const apex of apexes) {
        expect(distanceToRings(apex, traced), `side ${side}`).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('traces sprites pixel-exact at Smoothness 0, including diagonal pixel contacts', async () => {
    const sprites = [
      sprite(['####', '####', '####', '####'], 1),
      sprite(['##..', '##..', '####', '####'], 3),
      sprite(
        [
          '..######..',
          '.#......#.',
          '#..#..#..#',
          '#........#',
          '#.#....#.#',
          '#..####..#',
          '.#......#.',
          '..######..',
          '...#..#...',
          '..##..##..',
        ],
        1,
      ),
    ];
    const options: TraceOptions = { ...TRACE_PRESETS.Sharp!, smoothness: 0 };
    for (const { image, mask } of sprites) {
      const traced = rings(await traceImageToColoredPaths(image, options));
      expect(pixelBoundaryDistance(traced, image.width, image.height, mask)).toBeLessThanOrEqual(
        0.01,
      );
    }
  });
});
