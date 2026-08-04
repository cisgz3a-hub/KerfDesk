import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { planAdaptivePocket, type AdaptivePocketPlan } from './adaptive-pocket';
import { verifyAdaptivePocket } from './adaptive-pocket-verifier';

function square(x: number, y: number, size: number): Polyline {
  return rectangle(x, y, size, size);
}

function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function regularPolygon(segments: number): Polyline {
  return {
    closed: true,
    points: Array.from({ length: segments }, (_, index) => {
      const angle = (index / segments) * Math.PI * 2;
      return { x: 30 + Math.cos(angle) * 30, y: 30 + Math.sin(angle) * 30 };
    }),
  };
}

function uPocket(): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 28, y: 40 },
      { x: 28, y: 5 },
      { x: 12, y: 5 },
      { x: 12, y: 40 },
      { x: 0, y: 40 },
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
    expect(result.maxSimulatedEngagementMm).toBeLessThanOrEqual(0.5 + result.gridMm * Math.SQRT2);
  });

  it('rejects an unverified full-slot path', () => {
    const contours = [square(0, 0, 20)];
    const unsafe: AdaptivePocketPlan = {
      ok: true,
      optimalLoadMm: 0.5,
      sequences: [
        {
          entryCenter: { x: 10, y: 10 },
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
      reason: 'Adaptive verification simulated radial engagement above the configured limit.',
    });
  });

  it('verifies the split U-pocket plan without cutting across its kept-material notch', () => {
    const contours = [uPocket()];
    const plan = planAdaptivePocket(contours, 4, 2);
    expect(plan).toMatchObject({ ok: true, sequences: expect.any(Array) });
    if (!plan.ok) return;
    expect(plan.sequences).toHaveLength(2);
    expect(verifyAdaptivePocket(contours, 4, plan)).toMatchObject({ ok: true });
  });

  it('rejects the historical U-pocket connector through kept material', () => {
    const contours = [uPocket()];
    const unsafe: AdaptivePocketPlan = {
      ok: true,
      optimalLoadMm: 2,
      sequences: [
        {
          entryCenter: { x: 7, y: 10 },
          entryRadiusMm: 0.5,
          finishRings: [],
          rings: [
            {
              closed: false,
              points: [
                { x: 7, y: 5.9 },
                { x: 33, y: 5.9 },
              ],
            },
          ],
        },
      ],
    };
    expect(verifyAdaptivePocket(contours, 4, unsafe)).toMatchObject({
      ok: false,
      reason: 'Adaptive verification found a cutting move outside the requested pocket.',
    });
  });

  it('rejects a forged connector between disconnected pocket components', () => {
    const contours = [square(0, 0, 20), square(30, 0, 20)];
    const unsafe: AdaptivePocketPlan = {
      ok: true,
      optimalLoadMm: 0.5,
      sequences: [
        {
          entryCenter: { x: 10, y: 10 },
          entryRadiusMm: 0.5,
          finishRings: [],
          rings: [
            {
              closed: false,
              points: [
                { x: 10, y: 10 },
                { x: 40, y: 10 },
              ],
            },
          ],
        },
      ],
    };
    expect(verifyAdaptivePocket(contours, 4, unsafe)).toMatchObject({
      ok: false,
      reason: 'Adaptive verification found a cutting move outside the requested pocket.',
    });
  });

  it('rejects a helical entry whose cutter footprint leaves the pocket', () => {
    const contours = [square(0, 0, 20)];
    const plan = planAdaptivePocket(contours, 4, 0.5);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const first = plan.sequences[0];
    if (first === undefined) throw new Error('expected an adaptive sequence');
    const unsafe: AdaptivePocketPlan = {
      ...plan,
      sequences: [{ ...first, entryCenter: { x: 10, y: 10 }, entryRadiusMm: 9 }],
    };
    expect(verifyAdaptivePocket(contours, 4, unsafe)).toMatchObject({
      ok: false,
      reason: 'Adaptive verification found a cutting move outside the requested pocket.',
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
      expect(first.maxSimulatedEngagementMm).toBeLessThanOrEqual(0.5 + first.gridMm * Math.SQRT2);
    }
  });

  it.each([90, 360])(
    'verifies a regular %i-edge curved pocket',
    (segments) => {
      const contours = [regularPolygon(segments)];
      const plan = planAdaptivePocket(contours, 4, 0.5);
      expect(plan).toMatchObject({ ok: true });
      expect(verifyAdaptivePocket(contours, 4, plan)).toMatchObject({ ok: true });
    },
    20_000,
  );

  it('uses the canonical union boundary for edge-touching contours', () => {
    const splitContours = [rectangle(0, 0, 20, 20), rectangle(20, 0, 20, 20)];
    const wholeContour = [rectangle(0, 0, 40, 20)];
    const splitPlan = planAdaptivePocket(splitContours, 4, 2);
    const wholePlan = planAdaptivePocket(wholeContour, 4, 2);
    expect(splitPlan).toMatchObject({ ok: true, sequences: expect.any(Array) });
    expect(wholePlan).toMatchObject({ ok: true, sequences: expect.any(Array) });
    expect(splitPlan).toEqual(wholePlan);
    if (splitPlan.ok) expect(splitPlan.sequences).toHaveLength(1);
    const splitVerification = verifyAdaptivePocket(splitContours, 4, splitPlan);
    expect(splitVerification, JSON.stringify(splitVerification)).toMatchObject({ ok: true });
    expect(verifyAdaptivePocket(wholeContour, 4, wholePlan)).toMatchObject({ ok: true });
  });

  it('keeps a one-precision-unit source gap as separate verified components', () => {
    const contours = [rectangle(0, 0, 20, 20), rectangle(20.001, 0, 20, 20)];
    const plan = planAdaptivePocket(contours, 4, 2);
    expect(plan).toMatchObject({ ok: true, sequences: expect.any(Array) });
    if (plan.ok) expect(plan.sequences).toHaveLength(2);
    expect(verifyAdaptivePocket(contours, 4, plan)).toMatchObject({ ok: true });
  });

  it('refuses verification grids that cannot preserve the load resolution', () => {
    const contours = [square(0, 0, 1000)];
    expect(verifyAdaptivePocket(contours, 4, planAdaptivePocket(contours, 4, 0.5))).toMatchObject({
      ok: false,
      reason: 'Adaptive verification grid is too large; split the pocket into smaller operations.',
    });
  });
});
