import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { flattenStraightRuns } from './flatten-straight-runs';

const NO_CORNERS: ReadonlySet<Vec2> = new Set();

describe('flattenStraightRuns', () => {
  it('collapses a long wavy-but-straight run onto its fitted line at strength 1', () => {
    // ±0.8px wobble over 40px — the wobbly-stem case.
    const points: Vec2[] = [];
    for (let x = 0; x <= 40; x += 2) {
      points.push({ x, y: 0.8 * Math.sin(x / 4) });
    }
    const out = flattenStraightRuns(points, false, NO_CORNERS, 1);
    expect(out.length).toBeLessThanOrEqual(Math.ceil(points.length * 0.6));
    // Chain endpoints are pinned by object; interior survivors are either
    // original vertices or fitted-line replacements — every replacement must
    // sit near the true line (y = 0), never out at a wobble extreme the way
    // the old chord-between-noisy-endpoints replacement did.
    expect(out[0]).toBe(points[0]);
    expect(out[out.length - 1]).toBe(points[points.length - 1]);
    for (const p of out.slice(1, -1)) {
      if (!points.includes(p)) expect(Math.abs(p.y)).toBeLessThanOrEqual(0.35);
    }
  });

  it('erases larger wobble at higher strength', () => {
    const points: Vec2[] = [];
    for (let x = 0; x <= 40; x += 2) {
      points.push({ x, y: 1.2 * Math.sin(x / 4) });
    }
    const strength1 = flattenStraightRuns(points, false, NO_CORNERS, 1);
    const strength2 = flattenStraightRuns(points, false, NO_CORNERS, 2);
    expect(strength2.length).toBeLessThan(strength1.length);
  });

  it('is disabled at strength 0', () => {
    const points: Vec2[] = [];
    for (let x = 0; x <= 40; x += 2) {
      points.push({ x, y: 0.8 * Math.sin(x / 4) });
    }
    expect(flattenStraightRuns(points, false, NO_CORNERS, 0)).toEqual(points);
  });

  it('leaves a genuine circle untouched (sagitta gate)', () => {
    const r = 22;
    const ring: Vec2[] = [];
    const n = 48;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * 2 * Math.PI;
      ring.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    const out = flattenStraightRuns(ring, true, NO_CORNERS);
    // Every original vertex survives: no run on a circle of this radius may
    // qualify, so the ring must not be faceted.
    expect(out.length).toBe(ring.length);
  });

  it('never removes a corner vertex', () => {
    const corner: Vec2 = { x: 20, y: 0.2 };
    const points: Vec2[] = [];
    for (let x = 0; x <= 40; x += 2) {
      points.push(x === 20 ? corner : { x, y: x <= 20 ? 0 : (x - 20) * 0.01 });
    }
    const out = flattenStraightRuns(points, false, new Set([corner]));
    expect(out).toContain(corner);
  });

  it('keeps short chains as-is', () => {
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 3, y: 0.4 },
      { x: 6, y: 0 },
    ];
    expect(flattenStraightRuns(points, false, NO_CORNERS)).toEqual(points);
  });

  it('closed ring output repeats no seam point', () => {
    const ring: Vec2[] = [];
    for (let x = 0; x <= 30; x += 2) ring.push({ x, y: 0.5 * Math.sin(x / 3) });
    for (let x = 30; x >= 0; x -= 2) ring.push({ x, y: 20 + 0.5 * Math.sin(x / 3) });
    const out = flattenStraightRuns(ring, true, NO_CORNERS);
    expect(out[0]).not.toBe(out[out.length - 1]);
    expect(out.length).toBeGreaterThanOrEqual(4);
  });
});
