// Small-glyph fidelity instrument for the contour backend (own-engine gate).
//
// LANGEBAAN-scale letters (~28px cap height) exposed a defect class the
// whole-image metrics are blind to: outlines drawn PAST the letter shape —
// pointed "leaf" counters, apex spikes, chamfered corners, melted bowls.
// This instrument renders synthetic glyphs the way real text reaches the
// tracer (anti-aliased coverage, then the Line Art threshold) and measures
// the distance of every DRAWN outline sample from the true glyph boundary:
// spikes, melted bowls, and cut corners all show up as samples far from any
// true edge. Shapes use polygon edges and circular counters so the
// distance-to-boundary is exact.

import { describe, expect, it } from 'vitest';
import { traceImageToContourColoredPaths } from './contour-trace';
import type { RawImageData, TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;

const SIZE = 64;
const RGBA_CHANNELS = 4;
// Anti-aliased rendering: 4×4 coverage samples per pixel, like a rasterizer.
const COVERAGE_GRID = 4;
const SEGMENT_SAMPLE_STEP_PX = 0.75;

type Vec = { readonly x: number; readonly y: number };
type Circle = { readonly cx: number; readonly cy: number; readonly r: number };

// ——— B-like glyph: 20×28 rectangle body with two round counters. ———
const B_BODY: ReadonlyArray<Vec> = [
  { x: 22, y: 18 },
  { x: 42, y: 18 },
  { x: 42, y: 46 },
  { x: 22, y: 46 },
];
const B_COUNTERS: ReadonlyArray<Circle> = [
  { cx: 32, cy: 25.5, r: 4.4 },
  { cx: 32, cy: 38.5, r: 4.4 },
];

// ——— A-like glyph: triangle with a triangular counter (sharp apex). ———
const A_OUTER: ReadonlyArray<Vec> = [
  { x: 32, y: 16 },
  { x: 45, y: 46 },
  { x: 19, y: 46 },
];
const A_COUNTER: ReadonlyArray<Vec> = [
  { x: 32, y: 24.5 },
  { x: 37.5, y: 38 },
  { x: 26.5, y: 38 },
];

type Glyph = {
  readonly name: string;
  readonly inside: (x: number, y: number) => boolean;
  readonly boundaryDistance: (x: number, y: number) => number;
};

const B_GLYPH: Glyph = {
  name: 'B-like round counters',
  inside: (x, y) => pointInPolygon(x, y, B_BODY) && !B_COUNTERS.some((c) => inCircle(x, y, c)),
  boundaryDistance: (x, y) =>
    Math.min(
      polygonBoundaryDistance(x, y, B_BODY),
      ...B_COUNTERS.map((c) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r)),
    ),
};

const A_GLYPH: Glyph = {
  name: 'A-like sharp apex',
  inside: (x, y) => pointInPolygon(x, y, A_OUTER) && !pointInPolygon(x, y, A_COUNTER),
  boundaryDistance: (x, y) =>
    Math.min(polygonBoundaryDistance(x, y, A_OUTER), polygonBoundaryDistance(x, y, A_COUNTER)),
};

function renderGlyph(glyph: Glyph): RawImageData {
  const data = new Uint8ClampedArray(SIZE * SIZE * RGBA_CHANNELS);
  const step = 1 / COVERAGE_GRID;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < COVERAGE_GRID; sy += 1) {
        for (let sx = 0; sx < COVERAGE_GRID; sx += 1) {
          if (glyph.inside(x + (sx + 0.5) * step, y + (sy + 0.5) * step)) covered += 1;
        }
      }
      // Ink coverage → luma, the way font rasterization reaches the tracer.
      const value = Math.round(255 * (1 - covered / (COVERAGE_GRID * COVERAGE_GRID)));
      const base = (y * SIZE + x) * RGBA_CHANNELS;
      data[base] = value;
      data[base + 1] = value;
      data[base + 2] = value;
      data[base + 3] = 255;
    }
  }
  return { width: SIZE, height: SIZE, data };
}

type Fidelity = { readonly maxPx: number; readonly rmsPx: number; readonly samples: number };

// Distance of every drawn outline sample from the true glyph boundary.
function traceFidelity(glyph: Glyph): Fidelity {
  const paths = traceImageToContourColoredPaths(renderGlyph(glyph), LINE_ART);
  const deviations: number[] = [];
  for (const path of paths) {
    for (const polyline of path.polylines) {
      const pts = polyline.points;
      const count = polyline.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < count; i += 1) {
        const a = pts[i] as Vec;
        const b = pts[(i + 1) % pts.length] as Vec;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(length / SEGMENT_SAMPLE_STEP_PX));
        for (let s = 0; s < steps; s += 1) {
          const u = s / steps;
          deviations.push(glyph.boundaryDistance(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u));
        }
      }
    }
  }
  const samples = deviations.length;
  if (samples === 0) return { maxPx: Infinity, rmsPx: Infinity, samples };
  const max = deviations.reduce((m, v) => Math.max(m, v), 0);
  const sumSq = deviations.reduce((s, v) => s + v * v, 0);
  return { maxPx: max, rmsPx: Math.sqrt(sumSq / samples), samples };
}

describe('contour backend small-glyph fidelity (Line Art defaults)', () => {
  it('keeps the drawn outline on the B-like glyph boundary (round counters stay round)', () => {
    const f = traceFidelity(B_GLYPH);
    expect(f.samples).toBeGreaterThanOrEqual(80);
    expect(f.maxPx).toBeLessThanOrEqual(0.8);
    expect(f.rmsPx).toBeLessThanOrEqual(0.3);
  });

  it('keeps the drawn outline on the A-like glyph boundary (no apex spikes)', () => {
    const f = traceFidelity(A_GLYPH);
    expect(f.samples).toBeGreaterThanOrEqual(80);
    expect(f.maxPx).toBeLessThanOrEqual(0.8);
    // 0.32 (was 0.30): the rounded-terminal policy (curve-refine fillet
    // continuation, maintainer verdicts 2026-07-10) lets the apex round
    // slightly instead of pinning angular — +0.01px RMS in upscaled chain
    // space (~0.005px at glyph scale), sub-perceptual. The 0.8 max cap
    // above is the spike/melt guard and is unchanged.
    expect(f.rmsPx).toBeLessThanOrEqual(0.32);
  });
});

// ——— exact geometry helpers ———

function inCircle(x: number, y: number, c: Circle): boolean {
  return Math.hypot(x - c.cx, y - c.cy) <= c.r;
}

function pointInPolygon(x: number, y: number, poly: ReadonlyArray<Vec>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i] as Vec;
    const b = poly[j] as Vec;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function polygonBoundaryDistance(x: number, y: number, poly: ReadonlyArray<Vec>): number {
  let min = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i] as Vec;
    const b = poly[(i + 1) % poly.length] as Vec;
    min = Math.min(min, pointToSegment(x, y, a, b));
  }
  return min;
}

function pointToSegment(x: number, y: number, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(x - a.x, y - a.y);
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lenSq));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}
