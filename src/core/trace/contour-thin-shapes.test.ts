// Thin shapes through the whole filled-contour pipeline (ADR-482 review).
//
// Binary thin bars: the binary tail's Catmull-Rom resample bowed each long
// side of a bar toward its end caps, and the compact fit through it could
// add its own tolerance on the same side. A binary 2 px bar on Line Art's
// 2x route gained 41% area on the ADR-439 base and 49% with the first
// compact fit; 4 px bars at 15 and 30 degrees 20-25%. The dense chord band
// (contour-chord-band.ts) keeps every long side on its run.
//
// Sub-pixel walls: rings and arcs under a pixel wide come out as slivers
// whose sides nearly touch. The exact cubics must neither loop nor cross,
// which the topology repair can only promise when the compatibility
// polyline it tests stays within 0.02 px of the cubics.

import { describe, expect, it } from 'vitest';
import { evaluateCubic } from '../geometry/cubic-fit';
import type { ColoredPath, CurveSubpath, Polyline, Vec2 } from '../scene';
import { cubicSelfIntersects } from './compact-curve-shape';
import { intersectingContourLoopsSteps } from './contour-intersections';
import type { RawImageData, TraceOptions } from './index';
import { TRACE_PRESETS, traceImageToColoredPaths } from './index';
import { runTraceSteps } from './trace-steps';

const SIZE = 200;
const SUPERSAMPLES = 6;
const BAR_LENGTH = 120;

type Coverage = (x: number, y: number) => number;

function render(coverage: Coverage, binary: boolean): RawImageData {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < SUPERSAMPLES; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLES; sx += 1) {
          covered += coverage(x + (sx + 0.5) / SUPERSAMPLES, y + (sy + 0.5) / SUPERSAMPLES);
        }
      }
      let c = covered / SUPERSAMPLES ** 2;
      if (binary) c = c >= 0.5 ? 1 : 0;
      const v = Math.round(255 * (1 - c));
      data.set([v, v, v, 255], 4 * (y * SIZE + x));
    }
  }
  return { width: SIZE, height: SIZE, data };
}

function bar(width: number, degrees: number): Coverage {
  const r = (degrees * Math.PI) / 180;
  return (x, y) => {
    const dx = x - SIZE / 2;
    const dy = y - SIZE / 2;
    const along = dx * Math.cos(r) + dy * Math.sin(r);
    const across = -dx * Math.sin(r) + dy * Math.cos(r);
    return Math.abs(along) <= BAR_LENGTH / 2 && Math.abs(across) <= width / 2 ? 1 : 0;
  };
}

function rings(cx: number, cy: number, radii: ReadonlyArray<number>, width: number): Coverage {
  return (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    return radii.some((r) => d >= r && d <= r + width) ? 1 : 0;
  };
}

function arc(cx: number, cy: number, r: number, width: number): Coverage {
  return (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    const a = Math.atan2(y - cy, x - cx);
    return d >= r && d <= r + width && Math.abs(a) < 2.5 ? 1 : 0;
  };
}

function flatten(curve: CurveSubpath, perCubic: number): Vec2[] {
  const out: Vec2[] = [curve.start];
  let current = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind === 'cubic') {
      const c = { p0: current, p1: segment.control1, p2: segment.control2, p3: segment.to };
      for (let i = 1; i < perCubic; i += 1) out.push(evaluateCubic(c, i / perCubic));
    }
    out.push(segment.to);
    current = segment.to;
  }
  return out;
}

function area(points: ReadonlyArray<Vec2>): number {
  let twice = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] as Vec2;
    twice += p.x * q.y - q.x * p.y;
  });
  return Math.abs(twice) / 2;
}

function inkPixels(image: RawImageData): number {
  let count = 0;
  for (let i = 0; i < image.width * image.height; i += 1) {
    if ((image.data[4 * i] ?? 255) < 128) count += 1;
  }
  return count;
}

function cubics(paths: ReadonlyArray<ColoredPath>): Array<{ curve: CurveSubpath; index: number }> {
  return paths.flatMap((path) =>
    (path.curves ?? []).flatMap((curve) => curve.segments.map((_, index) => ({ curve, index }))),
  );
}

function trace(image: RawImageData, preset: string, optimize?: number): Promise<ColoredPath[]> {
  const options: TraceOptions = {
    ...(TRACE_PRESETS[preset] as TraceOptions),
    ...(optimize === undefined ? {} : { optimize }),
  };
  return traceImageToColoredPaths(image, options);
}

const BAR_CELLS = (['Line Art', 'Smooth'] as const).flatMap((preset) =>
  (
    [
      [2, 0],
      [3, 30],
      [4, 15],
      [4, 30],
      [6, 30],
    ] as const
  ).map(([width, degrees]) => ({ preset: preset as string, width, degrees })),
);

describe('thin shapes keep their size and their topology (ADR-482)', () => {
  it.each([
    ...BAR_CELLS,
    { preset: 'Sharp', width: 2, degrees: 15 },
    { preset: 'Sharp', width: 4, degrees: 30 },
  ])(
    'binary $width px bar at $degrees° on $preset keeps its area',
    async ({ preset, width, degrees }) => {
      const image = render(bar(width, degrees), true);
      const paths = await trace(image, preset);
      const outlines = paths.flatMap((path) => path.curves ?? []);
      expect(outlines).toHaveLength(1);
      const change = area(flatten(outlines[0] as CurveSubpath, 64)) / inkPixels(image) - 1;
      // ADR-439 base: +41% (2 px, 0°), +20..50% (3-6 px at 15-30°) on Line Art
      // and Smooth.
      const [low, high] = preset === 'Sharp' ? [-0.03, 0.03] : [-0.1, 0.08];
      expect(change).toBeGreaterThanOrEqual(low);
      expect(change).toBeLessThanOrEqual(high);
    },
  );

  const WALLS: Array<[string, Coverage]> = [
    ['0.8 px ring', rings(100.63, 99.57, [12.6], 0.8)],
    ['nested 0.8 px rings', rings(100.3, 99.6, [10, 12, 14, 16.5, 19, 22], 0.8)],
    ['2 px C-arc', arc(100.2, 100.4, 20, 2)],
    // Without the loop guard, binary Edge Detection drew one looping cubic
    // here at Optimize 1 and 2.
    ['3 px C-arc', arc(100.45, 99.8, 15, 3)],
  ];
  const WALL_CELLS = WALLS.flatMap(([name, coverage]) =>
    [true, false].flatMap((binary) =>
      ['Line Art', 'Edge Detection'].flatMap((preset) =>
        [0, 1, 2].map((optimize) => ({ name, coverage, binary, preset, optimize })),
      ),
    ),
  );

  it.each(WALL_CELLS)(
    '$name (binary $binary) on $preset at Optimize $optimize: no loops, no crossings',
    async ({ coverage, binary, preset, optimize }) => {
      const paths = await trace(render(coverage, binary), preset, optimize);
      const polylines: Polyline[] = paths.flatMap((path) => path.polylines);
      expect(polylines.length).toBeGreaterThan(0);
      expect(runTraceSteps(intersectingContourLoopsSteps(polylines)).size).toBe(0);
      for (const { curve, index } of cubics(paths)) {
        const segment = curve.segments[index];
        if (segment?.kind !== 'cubic') continue;
        const from = index === 0 ? curve.start : (curve.segments[index - 1]?.to as Vec2);
        const c = { p0: from, p1: segment.control1, p2: segment.control2, p3: segment.to };
        expect(cubicSelfIntersects(c)).toBe(false);
      }
    },
  );
});
