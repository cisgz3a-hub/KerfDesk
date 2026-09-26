import { describe, expect, it } from 'vitest';
import { evaluateCubic, newtonProjectionStep, type CubicBezier } from '../geometry/cubic-fit';
import type { Vec2 } from '../scene';
import { projectSpan } from './compact-curve-project';

// The reference pass: cubic-fit.ts's own Newton step and evaluation, which
// projectSpan inlines on precomputed terms (ADR-405 speed amendment).
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
      if (!Object.is(pass.error, reference.error) || pass.index !== reference.index) mismatches += 1;
      for (let i = 0; i < n; i += 1) {
        if (!Object.is(out[i], reference.params[i])) mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
  });
});
