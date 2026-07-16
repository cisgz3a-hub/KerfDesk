import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../scene';
import { fairChainAlongArc } from './arc-fairing';

const NO_ANCHORS: ReadonlySet<Vec2> = new Set();

function ripplyCircle(radius: number, ripple: number, period: number): Vec2[] {
  const n = Math.round(2 * Math.PI * radius); // ~1px spacing, like a dense chain
  const points: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n;
    const r = radius + ripple * Math.sin((2 * Math.PI * i) / period);
    points.push({ x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a) });
  }
  return points;
}

function radialDeviation(points: ReadonlyArray<Vec2>, radius: number): number[] {
  return points.map((p) => Math.hypot(p.x - 100, p.y - 100) - radius);
}

describe('fairChainAlongArc', () => {
  it('flattens lattice-beat ripple on a large circle', () => {
    // ±0.3 px ripple with a 12 px period — the measured medial-axis residue
    // the Taubin passes cannot reach.
    const noisy = ripplyCircle(80, 0.3, 12);
    const faired = fairChainAlongArc(noisy, true, NO_ANCHORS);
    const before = radialDeviation(noisy, 80);
    const after = radialDeviation(faired, 80);
    const rms = (dev: number[]): number =>
      Math.sqrt(dev.reduce((s, d) => s + d * d, 0) / dev.length);
    expect(rms(after)).toBeLessThan(rms(before) * 0.5);
    expect(Math.max(...after.map(Math.abs))).toBeLessThan(0.2);
  });

  it('does not shrink or distort a clean small bowl (no Laplacian melt)', () => {
    const clean = ripplyCircle(4, 0, 1);
    const faired = fairChainAlongArc(clean, true, NO_ANCHORS);
    for (let i = 0; i < clean.length; i += 1) {
      const a = clean[i] as Vec2;
      const b = faired[i] as Vec2;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.06);
    }
  });

  it('caps every displacement at the sub-pixel noise bound', () => {
    // A 2 px spike is signal-scale; the fairing may pull at it but never
    // farther than the cap.
    const points = ripplyCircle(80, 0, 1);
    const spiked = points.map((p, i) => (i === 40 ? { x: p.x + 2, y: p.y } : p));
    const faired = fairChainAlongArc(spiked, true, NO_ANCHORS);
    const original = spiked[40] as Vec2;
    const moved = faired[40] as Vec2;
    expect(Math.hypot(moved.x - original.x, moved.y - original.y)).toBeLessThanOrEqual(0.45 + 1e-9);
  });

  it('pins anchor corners by identity and never crosses them', () => {
    // An L with a rippled horizontal arm: the corner must survive as the SAME
    // object, and fairing the arm must not drag points toward the other arm.
    const points: Vec2[] = [];
    for (let x = 0; x <= 30; x += 1) {
      points.push({ x, y: 0.25 * Math.sin((2 * Math.PI * x) / 6) });
    }
    const corner = points[points.length - 1] as Vec2;
    for (let y = 1; y <= 30; y += 1) points.push({ x: 30, y });
    const anchors = new Set<Vec2>([corner]);
    const faired = fairChainAlongArc(points, false, anchors);
    expect(faired[30]).toBe(corner);
    // The rippled arm flattens toward y = 0 across its middle; the balanced
    // windows shrink toward the pinned endpoint and corner, so edge vertices
    // are deliberately faired more gently.
    const armDev = faired.slice(8, 23).map((p) => Math.abs(p.y));
    expect(Math.max(...armDev)).toBeLessThan(0.15);
    // …and the vertical arm stays exactly vertical (no bleed across the pin).
    for (const p of faired.slice(31)) expect(Math.abs(p.x - 30)).toBeLessThan(0.05);
  });

  it('leaves open-chain endpoints untouched', () => {
    const points: Vec2[] = [];
    for (let x = 0; x <= 40; x += 1) {
      points.push({ x, y: 0.3 * Math.sin((2 * Math.PI * x) / 8) });
    }
    const first = points[0] as Vec2;
    const last = points[points.length - 1] as Vec2;
    const faired = fairChainAlongArc(points, false, NO_ANCHORS);
    expect(faired[0]).toBe(first);
    expect(faired[faired.length - 1]).toBe(last);
  });

  it('returns short chains unchanged', () => {
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    expect(fairChainAlongArc(points, false, NO_ANCHORS)).toEqual(points);
  });
});
