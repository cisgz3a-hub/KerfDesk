import { describe, expect, it } from 'vitest';
import { evaluateCubic, type CubicBezier } from '../geometry/cubic-fit';
import type { Vec2 } from '../scene';
import { cubicFlatnessSteps, cubicSelfIntersects } from './compact-curve-shape';

function cubic(...xy: number[]): CubicBezier {
  const p = (i: number): Vec2 => ({ x: xy[2 * i] as number, y: xy[2 * i + 1] as number });
  return { p0: p(0), p1: p(1), p2: p(2), p3: p(3) };
}

// Deterministic pseudo-random numbers in [0, 1).
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function crosses(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(c, d, a) * side(c, d, b) < 0 && side(a, b, c) * side(a, b, d) < 0;
}

// Brute force: a fine sampling of the cubic crosses itself.
function sampledSelfCrossing(c: CubicBezier, samples: number): boolean {
  const pts = Array.from({ length: samples + 1 }, (_, i) => evaluateCubic(c, i / samples));
  for (let i = 0; i < samples; i += 1) {
    for (let j = i + 2; j < samples; j += 1) {
      if (crosses(pts[i] as Vec2, pts[i + 1] as Vec2, pts[j] as Vec2, pts[j + 1] as Vec2)) {
        return true;
      }
    }
  }
  return false;
}

function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  const t =
    lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq));
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}

describe('compact curve shape checks (ADR-405)', () => {
  it('finds the loop the review found in a traced Edge Detection C-arc', () => {
    // 'from 25.906,29.482 C 24.879,29.711 26.219,30.108 24.812,29.383'
    expect(
      cubicSelfIntersects(cubic(25.906, 29.482, 24.879, 29.711, 26.219, 30.108, 24.812, 29.383)),
    ).toBe(true);
    expect(cubicSelfIntersects(cubic(0, 0, 3, 3, -2, 3, 1, 0))).toBe(true);
  });

  it('passes arcs, S-curves and straight cubics', () => {
    const k = 0.5523;
    expect(cubicSelfIntersects(cubic(1, 0, 1, k, k, 1, 0, 1))).toBe(false);
    expect(cubicSelfIntersects(cubic(0, 0, 1, 1, 2, -1, 3, 0))).toBe(false);
    expect(cubicSelfIntersects(cubic(0, 0, 1, 0, 2, 0, 3, 0))).toBe(false);
    expect(cubicSelfIntersects(cubic(0, 0, 0, 0, 3, 0, 3, 0))).toBe(false);
  });

  it('agrees with a fine sampling on random cubics', () => {
    const next = random(7);
    let loops = 0;
    for (let trial = 0; trial < 120; trial += 1) {
      const c = cubic(...Array.from({ length: 8 }, () => 10 * next()));
      const analytic = cubicSelfIntersects(c);
      if (analytic) loops += 1;
      expect(analytic).toBe(sampledSelfCrossing(c, 400));
    }
    // The sample must hold both kinds for the agreement to mean anything.
    expect(loops).toBeGreaterThan(5);
    expect(loops).toBeLessThan(115);
  });

  it('samples a cubic finely enough to stay within the flatness bound', () => {
    const next = random(11);
    for (let trial = 0; trial < 60; trial += 1) {
      const c = cubic(...Array.from({ length: 8 }, () => 20 * next()));
      for (const flatness of [0.02, 0.1]) {
        const steps = cubicFlatnessSteps(c, flatness);
        let worst = 0;
        for (let s = 0; s < steps; s += 1) {
          const a = evaluateCubic(c, s / steps);
          const b = evaluateCubic(c, (s + 1) / steps);
          for (let f = 1; f < 16; f += 1) {
            const p = evaluateCubic(c, (s + f / 16) / steps);
            worst = Math.max(worst, pointToSegment(p, a, b));
          }
        }
        expect(worst).toBeLessThanOrEqual(flatness);
      }
    }
  });
});
