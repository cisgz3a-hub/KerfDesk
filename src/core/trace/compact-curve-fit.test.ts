import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../scene';
import { evaluateCubic } from '../geometry/cubic-fit';
import { fitCompactRing, sampleCompactCurve } from './compact-curve-fit';
import { traceImageToContourColoredPaths } from './contour-trace';
import type { RawImageData, TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;
const OPTIMIZE_SWEEP = [0, 0.2, 0.5, 1, 1.5, 2];
const NO_MARKS: ReadonlySet<Vec2> = new Set();
const OPTIONS = { tolerance: 0.3, candidateTolerance: 0.15, tangentWindow: 2 };

function circle(cx: number, cy: number, r: number, wobble = 0): Vec2[] {
  const n = Math.max(12, Math.round(2 * Math.PI * r));
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    const rr = r + wobble * Math.sin(5 * a);
    return { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) };
  });
}

function rectangle(w: number, h: number): { points: Vec2[]; corners: Set<Vec2> } {
  const points: Vec2[] = [];
  const corners = new Set<Vec2>();
  const legs: Array<[Vec2, Vec2, number]> = [
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, w],
    [{ x: w, y: 0 }, { x: 0, y: 1 }, h],
    [{ x: w, y: h }, { x: -1, y: 0 }, w],
    [{ x: 0, y: h }, { x: 0, y: -1 }, h],
  ];
  for (const [from, dir, length] of legs) {
    for (let i = 0; i < length; i += 1) {
      const p = { x: from.x + dir.x * i, y: from.y + dir.y * i };
      if (i === 0) corners.add(p);
      points.push(p);
    }
  }
  return { points, corners };
}

// Largest distance from the dense chain to the fitted curve's fine sampling.
function deviation(points: ReadonlyArray<Vec2>, curve: CurveSubpath): number {
  const fine: Vec2[] = [];
  let current = curve.start;
  for (const segment of curve.segments) {
    const steps = 4000;
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      fine.push(
        segment.kind === 'cubic'
          ? evaluateCubic(
              { p0: current, p1: segment.control1, p2: segment.control2, p3: segment.to },
              t,
            )
          : {
              x: current.x + (segment.to.x - current.x) * t,
              y: current.y + (segment.to.y - current.y) * t,
            },
      );
    }
    current = segment.to;
  }
  return Math.max(
    ...points.map((p) => Math.min(...fine.map((q) => Math.hypot(q.x - p.x, q.y - p.y)))),
  );
}

function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  const t =
    lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq));
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}

function renderDisc(r: number, wobble: number, antialiased: boolean): RawImageData {
  const size = Math.ceil(2 * (r + wobble) + 16);
  const c = size / 2 + 0.3;
  const grid = antialiased ? 6 : 1;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < grid; sy += 1) {
        for (let sx = 0; sx < grid; sx += 1) {
          const dx = x + (sx + 0.5) / grid - c;
          const dy = y + (sy + 0.5) / grid - c;
          const edge = r + wobble * Math.sin(6 * Math.atan2(dy, dx));
          if (Math.hypot(dx, dy) <= edge) covered += 1;
        }
      }
      const value = Math.round(255 * (1 - covered / grid ** 2));
      data.set([value, value, value, 255], 4 * (y * size + x));
    }
  }
  return { width: size, height: size, data };
}

function segmentCount(image: RawImageData, optimize: number): number {
  return traceImageToContourColoredPaths(image, { ...LINE_ART, optimize })
    .flatMap((path) => path.curves ?? [])
    .reduce((total, curve) => total + curve.segments.length, 0);
}

describe('compact contour curves (ADR-440)', () => {
  it('fits a circle with a few G1 cubics within the tolerance', () => {
    for (const r of [8, 20, 48, 100]) {
      const points = circle(100, 100, r);
      const curve = fitCompactRing(points, NO_MARKS, OPTIONS);
      if (curve === null) throw new Error('expected a curve');
      expect(curve.closed).toBe(true);
      expect(curve.segments.every((s) => s.kind === 'cubic')).toBe(true);
      expect(curve.segments.length).toBeLessThanOrEqual(4);
      expect(deviation(points, curve)).toBeLessThanOrEqual(OPTIONS.tolerance + 1e-6);
      expect(curve.segments.at(-1)?.to).toBe(curve.start);
    }
  });

  it('emits a straight run between corners as one line and keeps the corners exact', () => {
    const { points, corners } = rectangle(120, 40);
    const curve = fitCompactRing(points, corners, OPTIONS);
    expect(curve?.segments.map((s) => s.kind)).toEqual(['line', 'line', 'line', 'line']);
    for (const segment of curve?.segments ?? []) expect(corners.has(segment.to)).toBe(true);
    // The compatibility polyline holds no collinear samples along a line.
    expect(sampleCompactCurve(curve as CurveSubpath)).toHaveLength(5);
  });

  it('samples the compatibility polyline within 0.02 px of every cubic', () => {
    // The topology repair tests these samples; exact cubics can then only
    // overlap where the samples come within 0.04 px, never cross visibly.
    const curve = fitCompactRing(circle(40, 40, 6, 1.2), NO_MARKS, OPTIONS);
    if (curve === null) throw new Error('expected a curve');
    const samples = sampleCompactCurve(curve);
    let current = curve.start;
    for (const segment of curve.segments) {
      if (segment.kind === 'cubic') {
        const c = { p0: current, p1: segment.control1, p2: segment.control2, p3: segment.to };
        for (let s = 1; s < 200; s += 1) {
          const p = evaluateCubic(c, s / 200);
          const nearest = Math.min(
            ...samples.slice(1).map((b, i) => pointToSegment(p, samples[i] as Vec2, b)),
          );
          expect(nearest).toBeLessThanOrEqual(0.02 + 1e-9);
        }
      }
      current = segment.to;
    }
  });

  it('never merges across an inflection', () => {
    // A five-lobed ring: ten arcs alternating convex and concave. Under a
    // tolerance loose enough for a few S-shaped cubics, the merge still keeps
    // at least one segment per arc.
    const points = circle(100, 100, 40, 6);
    const curve = fitCompactRing(points, NO_MARKS, { ...OPTIONS, tolerance: 3 });
    expect(curve?.segments.length ?? 0).toBeGreaterThanOrEqual(10);
  });

  it('never adds segments as the tolerance grows', () => {
    const shapes = [circle(60, 60, 30), circle(60, 60, 45, 3), circle(80, 80, 70, 1.2)];
    for (const points of shapes) {
      let previous = Infinity;
      for (const tolerance of [0.2, 0.3, 0.45, 0.7, 1, 1.5, 2.5]) {
        const curve = fitCompactRing(points, NO_MARKS, {
          ...OPTIONS,
          tolerance,
          candidateTolerance: 0.1,
        });
        const count = curve?.segments.length ?? 0;
        expect(count).toBeLessThanOrEqual(previous);
        previous = count;
      }
    }
  });

  it('makes the traced segment count monotone non-increasing in Optimize', () => {
    const images = [
      renderDisc(48, 0, false),
      renderDisc(30, 0, true),
      renderDisc(40, 4, false),
      renderDisc(40, 4, true),
    ];
    for (const image of images) {
      const counts = OPTIMIZE_SWEEP.map((optimize) => segmentCount(image, optimize));
      for (let i = 1; i < counts.length; i += 1) {
        expect(counts[i]).toBeLessThanOrEqual(counts[i - 1] as number);
      }
      expect(counts[counts.length - 1]).toBeLessThan(counts[0] as number);
    }
  });

  it('traces a binary disc and a binary square as compact curves', () => {
    const disc = traceImageToContourColoredPaths(renderDisc(48, 0, false), LINE_ART);
    const discSegments = disc.flatMap((path) => path.curves ?? []).flatMap((c) => c.segments);
    expect(discSegments.length).toBeLessThanOrEqual(8);
    expect(discSegments.every((s) => s.kind === 'cubic')).toBe(true);
    const size = 160;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 20; y < 140; y += 1) {
      for (let x = 20; x < 140; x += 1) data.set([0, 0, 0, 255], 4 * (y * size + x));
    }
    const square = traceImageToContourColoredPaths({ width: size, height: size, data }, LINE_ART);
    const squareSegments = square.flatMap((path) => path.curves ?? []).flatMap((c) => c.segments);
    expect(squareSegments.map((s) => s.kind)).toEqual(['line', 'line', 'line', 'line']);
  });
});
