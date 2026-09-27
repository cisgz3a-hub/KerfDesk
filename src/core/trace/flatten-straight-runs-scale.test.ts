import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { flattenStraightRuns } from './flatten-straight-runs';

// ADR-487: the joint-snap limit is denominated in source pixels, so the same
// artwork traced on a 1x, 1.5x or 2x working grid snaps the same joints.
// Synthetic soft bend: a straight along +x into the apex (40, 0), then a
// straight turned by `turnDeg`, both carrying a small deterministic
// perpendicular wobble so the flattener's side-balance gate reads them as
// noisy straights (an exact bend never forms a shared joint).
function wobblyBend(turnDeg: number, step: number, wobble: number, phase: number): Vec2[] {
  const turn = (turnDeg * Math.PI) / 180;
  const points: Vec2[] = [];
  let k = 0;
  const noise = (): number => wobble * Math.sin(k++ * phase);
  for (let x = 0; x < 40 - 1e-9; x += step) points.push({ x, y: noise() });
  for (let d = step; d <= 40; d += step) {
    const n = noise();
    points.push({
      x: 40 + d * Math.cos(turn) - n * Math.sin(turn),
      y: d * Math.sin(turn) + n * Math.cos(turn),
    });
  }
  return points;
}

// Trace the source-pixel artwork on a working grid `scale` times finer and
// map the result back to source pixels.
function flattenAtScale(source: ReadonlyArray<Vec2>, scale: number, strength = 1): Vec2[] {
  const grid = source.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  return flattenStraightRuns(grid, false, new Set(), strength, scale).map((p) => ({
    x: p.x / scale,
    y: p.y / scale,
  }));
}

const APEX: Vec2 = { x: 40, y: 0 };
const SCALES = [1, 1.5, 2] as const;

describe('flattenStraightRuns joint snap scale invariance (ADR-487)', () => {
  // Each case snapped to the apex at 1x but fell back to the projection
  // midpoint (~1.5-2 source px down the second leg) at 1.5x/2x before the
  // limit was scaled.
  const cases = [
    { turnDeg: 8, step: 1.5, wobble: 0.3, phase: 2.3 },
    { turnDeg: 12, step: 1, wobble: 0.4, phase: 2.9 },
    { turnDeg: 12, step: 1.5, wobble: 0.3, phase: 2.3 },
  ];

  it.each(cases)(
    'snaps the same joint at 1x, 1.5x and 2x (turn $turnDeg deg, step $step)',
    ({ turnDeg, step, wobble, phase }) => {
      const source = wobblyBend(turnDeg, step, wobble, phase);
      const [reference, ...others] = SCALES.map((scale) => flattenAtScale(source, scale));
      // The 1x reference keeps a joint at the true apex of the soft bend.
      const nearestToApex = Math.min(
        ...(reference as Vec2[]).map((p) => Math.hypot(p.x - APEX.x, p.y - APEX.y)),
      );
      expect(nearestToApex).toBeLessThan(0.4);
      for (const out of others) {
        expect(out.length).toBe((reference as Vec2[]).length);
        out.forEach((p, i) => {
          const r = (reference as Vec2[])[i] as Vec2;
          expect(Math.hypot(p.x - r.x, p.y - r.y)).toBeLessThanOrEqual(0.05);
        });
      }
    },
  );
});

describe('flattenStraightRuns activity gate scale invariance (ADR-487)', () => {
  // Smoothness ~0.86 gives strength 0.15: a 0.15 source-px budget, under the
  // 0.2 px activity floor. The flattener must stay off on every grid; gating
  // the SCALED budget turned it on at 1.5x/2x (0.225 and 0.3 grid px).
  it.each([0.1, 0.15, 0.19])(
    'leaves the chain untouched at strength %s on every grid',
    (strength) => {
      const source: Vec2[] = [];
      for (let k = 0; k <= 40; k += 1) source.push({ x: k, y: 0.08 * Math.sin(k * 2.3) });
      for (const scale of SCALES) {
        const out = flattenAtScale(source, scale, strength);
        expect(out.length).toBe(source.length);
        out.forEach((p, i) => {
          const r = source[i] as Vec2;
          expect(Math.hypot(p.x - r.x, p.y - r.y)).toBeLessThan(1e-9);
        });
      }
    },
  );
});
