import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { planAdaptivePocket, type AdaptivePocketPlan } from './adaptive-pocket';
import { verifyAdaptivePocket } from './adaptive-pocket-verifier';

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

describe('verifyAdaptivePocket', () => {
  it('proves bounded engagement and stock coverage for a square pocket', () => {
    const contours = [square(0, 0, 20)];
    const plan = planAdaptivePocket(contours, 4, 0.5);
    const result = verifyAdaptivePocket(contours, 4, plan);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.coverageRatio).toBeGreaterThanOrEqual(0.985);
    expect(result.maxMeasuredLoadMm).toBeLessThanOrEqual(0.5 + result.gridMm * Math.SQRT2);
  });

  it('rejects an unverified full-slot path', () => {
    const contours = [square(0, 0, 20)];
    const unsafe: AdaptivePocketPlan = {
      ok: true,
      optimalLoadMm: 0.5,
      sequences: [
        {
          entryCenter: { x: 10, y: 2 },
          entryRadiusMm: 0.5,
          finishRings: [],
          rings: [
            {
              closed: false,
              points: [
                { x: 10, y: 2 },
                { x: 10, y: 18 },
              ],
            },
          ],
        },
      ],
    };
    const result = verifyAdaptivePocket(contours, 4, unsafe);
    expect(result).toMatchObject({
      ok: false,
      reason: 'Adaptive verification measured radial engagement above the optimal load.',
    });
  });

  it('is deterministic and verified for disconnected pockets', () => {
    const contours = [square(0, 0, 30), square(40, 0, 20)];
    const plan = planAdaptivePocket(contours, 4, 0.5);
    const first = verifyAdaptivePocket(contours, 4, plan);
    expect(first).toEqual(verifyAdaptivePocket(contours, 4, plan));
    expect(first).toMatchObject({ ok: true });
    if (first.ok) {
      expect(first.coverageRatio).toBeGreaterThanOrEqual(0.985);
      expect(first.maxMeasuredLoadMm).toBeLessThanOrEqual(0.5 + first.gridMm * Math.SQRT2);
    }
  });

  it('refuses verification grids that cannot preserve the load resolution', () => {
    const contours = [square(0, 0, 1000)];
    expect(verifyAdaptivePocket(contours, 4, planAdaptivePocket(contours, 4, 0.5))).toMatchObject({
      ok: false,
      reason: 'Adaptive verification grid is too large; split the pocket into smaller operations.',
    });
  });
});
