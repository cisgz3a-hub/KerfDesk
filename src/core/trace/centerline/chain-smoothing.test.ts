// Behaviour tests for corner-anchored curvature smoothing. Two properties
// motivate the smoother (see chain-smoothing.ts): it must (a) drive the
// per-step curvature variance of a NOISY sampled arc down toward the clean
// arc it approximates, while (b) leaving a genuine sharp corner exactly on
// its vertex.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../scene';
import { smoothChainCurvature } from './chain-smoothing';

const NO_ANCHORS: ReadonlySet<Vec2> = new Set();

// Turn (radians) at each interior vertex of an open polyline.
function turnAt(prev: Vec2, at: Vec2, next: Vec2): number {
  const a1 = Math.atan2(at.y - prev.y, at.x - prev.x);
  const a2 = Math.atan2(next.y - at.y, next.x - at.x);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Variance of the per-step turn magnitudes: a curve that turns EVENLY (like a
// true arc sampled uniformly) has near-zero variance; pixel-scale noise
// inflates it.
function turnVariance(points: ReadonlyArray<Vec2>): number {
  const turns: number[] = [];
  for (let i = 1; i + 1 < points.length; i += 1) {
    turns.push(turnAt(points[i - 1] as Vec2, points[i] as Vec2, points[i + 1] as Vec2));
  }
  if (turns.length === 0) return 0;
  const mean = turns.reduce((s, t) => s + t, 0) / turns.length;
  return turns.reduce((s, t) => s + (t - mean) * (t - mean), 0) / turns.length;
}

// A quarter arc sampled at ~1px, with a deterministic ±0.35px wobble injected
// perpendicular to the radius (the pixel-lattice curvature noise the real
// tracer carries). Deterministic — no RNG — so the test is reproducible.
function noisyArc(): Vec2[] {
  const cx = 0;
  const cy = 0;
  const radius = 40;
  const points: Vec2[] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * (Math.PI / 2);
    // A bounded, mean-near-zero wobble from two incommensurate sinusoids.
    const wobble = 0.35 * (Math.sin(i * 1.9) * 0.6 + Math.sin(i * 0.7 + 1) * 0.4);
    const r = radius + wobble;
    points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return points;
}

describe('smoothChainCurvature', () => {
  it('reduces per-step curvature variance on a noisy sampled arc', () => {
    const noisy = noisyArc();
    const smoothed = smoothChainCurvature(noisy, false, NO_ANCHORS);
    expect(smoothed).toHaveLength(noisy.length);
    // The wobble must be substantially damped — at least halved.
    expect(turnVariance(smoothed)).toBeLessThan(turnVariance(noisy) * 0.5);
  });

  it('keeps a sharp 90-degree corner within epsilon of its vertex', () => {
    // Two straight legs meeting at a right angle, densely sampled, with the
    // apex marked as an anchor by reference.
    const apex: Vec2 = { x: 20, y: 20 };
    const points: Vec2[] = [];
    for (let x = 0; x <= 20; x += 1) points.push({ x, y: 0 });
    points.push(apex);
    for (let y = 1; y <= 20; y += 1) points.push({ x: 20, y });
    const anchors: ReadonlySet<Vec2> = new Set([apex]);
    const smoothed = smoothChainCurvature(points, false, anchors);
    let nearest = Infinity;
    for (const p of smoothed) nearest = Math.min(nearest, Math.hypot(p.x - apex.x, p.y - apex.y));
    expect(nearest).toBeLessThan(1e-6);
  });

  it('preserves the exact anchor object references (for corner pinning)', () => {
    // Output refinement pins corners by object identity; the smoother must not
    // clone anchor points or the pin silently misses.
    const apex: Vec2 = { x: 10, y: 10 };
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      apex,
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ];
    const anchors: ReadonlySet<Vec2> = new Set([apex]);
    const smoothed = smoothChainCurvature(points, false, anchors);
    expect(smoothed).toContain(apex);
  });

  it('pins both endpoints of an open chain in place', () => {
    const points: Vec2[] = [];
    for (let i = 0; i <= 20; i += 1) points.push({ x: i, y: Math.sin(i) * 0.4 });
    const first = points[0] as Vec2;
    const last = points.at(-1) as Vec2;
    const smoothed = smoothChainCurvature(points, false, NO_ANCHORS);
    expect(smoothed[0]).toEqual(first);
    expect(smoothed.at(-1)).toEqual(last);
  });

  it('does not shrink a closed circle toward its centre', () => {
    // Taubin's negative-mu pass re-inflates what the lambda pass contracts; a
    // sampled circle must keep its radius (the melting-bowl defect).
    const radius = 30;
    const points: Vec2[] = [];
    const steps = 64;
    for (let i = 0; i < steps; i += 1) {
      const a = (i / steps) * 2 * Math.PI;
      points.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
    }
    const smoothed = smoothChainCurvature(points, true, NO_ANCHORS);
    const meanRadius = smoothed.reduce((s, p) => s + Math.hypot(p.x, p.y), 0) / smoothed.length;
    expect(Math.abs(meanRadius - radius)).toBeLessThan(0.15);
  });
});
