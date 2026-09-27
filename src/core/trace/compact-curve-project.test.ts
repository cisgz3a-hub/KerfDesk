import { describe, expect, it } from 'vitest';
import { evaluateCubic, newtonProjectionStep, type CubicBezier } from '../geometry/cubic-fit';
import type { Vec2 } from '../scene';
import { projectSpan, reverseSpan } from './compact-curve-project';
import { chordSpanFit } from './compact-curve-span';

// The reference pass: cubic-fit.ts's own Newton step and evaluation, which
// projectSpan inlines on precomputed terms (ADR-482 speed amendment).
function referencePass(span: ReadonlyArray<Vec2>, cubic: CubicBezier, u: ReadonlyArray<number>) {
  const params = [...u];
  let error = 0;
  let index = span.length >> 1;
  for (let i = 1; i < span.length - 1; i += 1) {
    const p = span[i] as Vec2;
    let t = u[i] as number;
    for (let step = 0; step < 4; step += 1) {
      const raw = newtonProjectionStep(cubic, p, t);
      if (raw === null) break;
      const next = Math.min(1, Math.max(0, raw));
      if (Math.abs(next - t) < 1e-9) {
        t = next;
        break;
      }
      t = next;
    }
    params[i] = t;
    const q = evaluateCubic(cubic, t);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d > error) {
      error = d;
      index = i;
    }
  }
  return { params, error, index };
}

describe('projectSpan', () => {
  it('matches the shared Newton step and evaluation bit for bit', () => {
    let state = 24681357;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    let mismatches = 0;
    for (let trial = 0; trial < 300; trial += 1) {
      const scale = 10 ** (next() * 4 - 1);
      const point = (): Vec2 => ({ x: (next() - 0.5) * scale, y: (next() - 0.5) * scale });
      const cubic = { p0: point(), p1: point(), p2: point(), p3: point() };
      const n = 3 + Math.floor(next() * 60);
      const span: Vec2[] = [];
      const u: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const t = i / (n - 1);
        const q = evaluateCubic(cubic, t);
        span.push({ x: q.x + (next() - 0.5) * scale * 0.1, y: q.y + (next() - 0.5) * scale * 0.1 });
        u.push(Math.min(1, Math.max(0, t + (next() - 0.5) * 0.05)));
      }
      u[0] = 0;
      u[n - 1] = 1;
      const out = new Float64Array(n);
      const pass = projectSpan(span, cubic, u, out, Infinity, false);
      const reference = referencePass(span, cubic, u);
      if (!Object.is(pass.error, reference.error) || pass.index !== reference.index)
        mismatches += 1;
      for (let i = 0; i < n; i += 1) {
        if (!Object.is(out[i], reference.params[i])) mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
  });
});

// Distance from p to segment ab, every root taken (the arithmetic the pruned
// loops keep).
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

describe('squared-distance pruning keeps every bit', () => {
  // Spans with exact ties (points on a line parallel to the chord, a regular
  // polygon) and random wobble, over five decades of scale.
  const spans = (): Vec2[][] => {
    let state = 97531;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const out: Vec2[][] = [];
    for (let trial = 0; trial < 200; trial += 1) {
      const scale = 10 ** (next() * 5 - 2);
      const n = 3 + Math.floor(next() * 50);
      const kind = trial % 3;
      const span: Vec2[] = [];
      for (let i = 0; i < n; i += 1) {
        const f = i / (n - 1);
        if (kind === 0) span.push({ x: f * scale, y: i === 0 || i === n - 1 ? 0 : scale / 7 });
        else if (kind === 1) {
          const a = f * Math.PI;
          span.push({ x: Math.cos(a) * scale, y: Math.sin(a) * scale });
        } else span.push({ x: f * scale, y: (next() - 0.5) * scale * 0.2 });
      }
      out.push(span);
    }
    return out;
  };

  it('chord deviation equals the maximum of every point-to-chord distance', () => {
    let mismatches = 0;
    for (const span of spans()) {
      const a = span[0] as Vec2;
      const b = span.at(-1) as Vec2;
      let worst = 0;
      for (let i = 1; i < span.length - 1; i += 1) {
        worst = Math.max(worst, segmentDistance(span[i] as Vec2, a, b));
      }
      if (!Object.is(chordSpanFit(span).lineError, worst)) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });

  it('the reverse check equals its unpruned sliding-window minimum', () => {
    let mismatches = 0;
    for (const span of spans()) {
      const p0 = span[0] as Vec2;
      const p3 = span.at(-1) as Vec2;
      const third = { x: (p3.x - p0.x) / 3, y: (p3.y - p0.y) / 3 };
      const cubic = {
        p0,
        p1: { x: p0.x + third.x - third.y, y: p0.y + third.y + third.x },
        p2: { x: p3.x - third.x - third.y, y: p3.y - third.y + third.x },
        p3,
      };
      const got = reverseSpan(span, cubic, null, Infinity);
      const polygon =
        Math.hypot(cubic.p1.x - p0.x, cubic.p1.y - p0.y) +
        Math.hypot(cubic.p2.x - cubic.p1.x, cubic.p2.y - cubic.p1.y) +
        Math.hypot(p3.x - cubic.p2.x, p3.y - cubic.p2.y);
      const samples = Math.max(4, Math.ceil(polygon / 0.5));
      let segment = 0;
      let error = 0;
      for (let s = 1; s < samples; s += 1) {
        const q = evaluateCubic(cubic, s / samples);
        let best = Infinity;
        const lo = Math.max(0, segment - 4);
        const hi = Math.min(span.length - 2, segment + 12);
        for (let k = lo; k <= hi; k += 1) {
          const d = segmentDistance(q, span[k] as Vec2, span[k + 1] as Vec2);
          if (d < best) {
            best = d;
            segment = k;
          }
        }
        error = Math.max(error, best);
      }
      if (!Object.is(got.error, error)) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });
});
