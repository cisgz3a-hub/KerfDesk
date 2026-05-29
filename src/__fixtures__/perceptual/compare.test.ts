import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareMasks } from './compare';
import { createMask, rasterizePolylines } from './rasterize';
import type { Mask } from './rasterize';

function maskFrom(width: number, height: number, bits: number[]): Mask {
  return { width, height, data: Uint8Array.from(bits) };
}

describe('compareMasks', () => {
  it('scores identical masks as a perfect match', () => {
    const m = maskFrom(2, 2, [1, 0, 1, 1]);
    const metrics = compareMasks(m, m);
    expect(metrics.iou).toBe(1);
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
    expect(metrics.f1).toBe(1);
    expect(metrics.agreement).toBe(1);
  });

  it('scores fully disjoint masks as zero overlap', () => {
    const pred = maskFrom(2, 2, [1, 1, 0, 0]);
    const truth = maskFrom(2, 2, [0, 0, 1, 1]);
    const metrics = compareMasks(pred, truth);
    expect(metrics.truePositive).toBe(0);
    expect(metrics.iou).toBe(0);
    expect(metrics.precision).toBe(0);
    expect(metrics.recall).toBe(0);
    expect(metrics.f1).toBe(0);
    // Every pixel is ink in exactly one mask, so there is no shared
    // background and nothing agrees.
    expect(metrics.agreement).toBe(0);
  });

  it('computes a hand-checked partial-overlap example', () => {
    // pred  = 1 1 1 0
    // truth = 1 1 0 1
    // TP=2 (idx 0,1), FP=1 (idx 2), FN=1 (idx 3), TN=0.
    const pred = maskFrom(4, 1, [1, 1, 1, 0]);
    const truth = maskFrom(4, 1, [1, 1, 0, 1]);
    const metrics = compareMasks(pred, truth);
    expect(metrics.truePositive).toBe(2);
    expect(metrics.falsePositive).toBe(1);
    expect(metrics.falseNegative).toBe(1);
    expect(metrics.trueNegative).toBe(0);
    expect(metrics.iou).toBeCloseTo(0.5, 10); // 2 / 4
    expect(metrics.precision).toBeCloseTo(2 / 3, 10);
    expect(metrics.recall).toBeCloseTo(2 / 3, 10);
    expect(metrics.f1).toBeCloseTo(2 / 3, 10);
    expect(metrics.agreement).toBeCloseTo(0.5, 10); // (2+0) / 4
  });

  it('treats two empty masks as a perfect match (0/0 → 1)', () => {
    const empty = createMask(8, 8);
    const metrics = compareMasks(empty, empty);
    expect(metrics.iou).toBe(1);
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
    expect(metrics.f1).toBe(1);
    expect(metrics.agreement).toBe(1);
  });

  it('an empty prediction against real ink scores recall 0 but precision 1', () => {
    // Predicting nothing produces no false positives (vacuous precision=1)
    // but misses everything (recall=0). IoU collapses to 0.
    const pred = createMask(2, 2);
    const truth = maskFrom(2, 2, [1, 1, 0, 0]);
    const metrics = compareMasks(pred, truth);
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(0);
    expect(metrics.iou).toBe(0);
    expect(metrics.f1).toBe(0);
    expect(metrics.agreement).toBe(0.5); // 2 background pixels agree
  });

  it('a too-thick prediction (over-inking) is caught by precision, not recall', () => {
    // Truth inks 1 pixel; prediction inks 3 (the 1 correct + 2 spurious),
    // mimicking an outline tracer's doubled contour. Recall stays perfect;
    // precision drops to 1/3.
    const pred = maskFrom(4, 1, [1, 1, 1, 0]);
    const truth = maskFrom(4, 1, [1, 0, 0, 0]);
    const metrics = compareMasks(pred, truth);
    expect(metrics.recall).toBe(1);
    expect(metrics.precision).toBeCloseTo(1 / 3, 10);
    expect(metrics.iou).toBeCloseTo(1 / 3, 10);
  });

  it('throws on a dimension mismatch rather than silently comparing', () => {
    const a = createMask(4, 4);
    const b = createMask(4, 5);
    expect(() => compareMasks(a, b)).toThrow(/mismatch/);
  });

  it('scores a rasterized shape against itself as IoU 1', () => {
    const shape = rasterizePolylines(
      [
        {
          closed: true,
          points: [
            { x: 2, y: 2 },
            { x: 12, y: 2 },
            { x: 12, y: 12 },
            { x: 2, y: 12 },
          ],
        },
      ],
      16,
      16,
    );
    expect(compareMasks(shape, shape).iou).toBe(1);
  });

  it('property: every ratio metric stays within [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1 }), { minLength: 16, maxLength: 16 }),
        fc.array(fc.integer({ min: 0, max: 1 }), { minLength: 16, maxLength: 16 }),
        (predBits, truthBits) => {
          const metrics = compareMasks(maskFrom(4, 4, predBits), maskFrom(4, 4, truthBits));
          for (const value of [
            metrics.iou,
            metrics.precision,
            metrics.recall,
            metrics.f1,
            metrics.agreement,
          ]) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
