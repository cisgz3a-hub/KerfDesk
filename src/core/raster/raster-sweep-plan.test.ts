import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { planRasterRowSweeps } from './raster-sweep-plan';

const ROW = new Uint16Array([500, 0, 0, 0, 0, 0, 0, 500]);

describe('split scan runways', () => {
  it.each([false, true])('shares a 6 mm blank gap on both sides (reverse=%s)', (reverse) => {
    const plans = planRasterRowSweeps({ row: ROW, pixelWidthMm: 1, overscanMm: 5, reverse });

    expect(plans.map(({ leadInMm, leadOutMm }) => [leadInMm, leadOutMm])).toEqual([
      [5, 3],
      [3, 5],
    ]);
    expect(plans.flatMap((plan) => plan.runs).map((run) => run.s)).toEqual([500, 500]);
  });

  it('keeps the middle of a wide gap available for a positioning move', () => {
    const plans = planRasterRowSweeps({
      row: ROW,
      pixelWidthMm: 3,
      overscanMm: 5,
      reverse: false,
    });
    expect(plans.map(({ leadInMm, leadOutMm }) => [leadInMm, leadOutMm])).toEqual([
      [5, 5],
      [5, 5],
    ]);
    expect(18 - plans[0]!.leadOutMm - plans[1]!.leadInMm).toBe(8);
  });

  it('respects an explicitly disabled Image overscan', () => {
    const plans = planRasterRowSweeps({ row: ROW, pixelWidthMm: 1, overscanMm: 0, reverse: true });
    expect(plans.every((plan) => plan.leadInMm === 0 && plan.leadOutMm === 0)).toBe(true);
  });

  it('never overlaps, backtracks or exceeds the requested runway on either direction', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 5.01, max: 100, noNaN: true }),
        fc.double({ min: 0.001, max: 25, noNaN: true }),
        fc.boolean(),
        (gapMm, overscanMm, reverse) => {
          const pixelWidthMm = gapMm / 6;
          const plans = planRasterRowSweeps({ row: ROW, pixelWidthMm, overscanMm, reverse });
          const first = plans[0]!;
          const second = plans[1]!;
          expect(first.leadInMm).toBe(overscanMm);
          expect(second.leadOutMm).toBe(overscanMm);
          expect(first.leadOutMm).toBeGreaterThan(0);
          expect(first.leadOutMm).toBe(second.leadInMm);
          expect(first.leadOutMm).toBeLessThanOrEqual(overscanMm);
          expect(first.leadOutMm + second.leadInMm).toBeLessThanOrEqual(gapMm + 1e-9);
          const exit = reverse
            ? first.span.firstX * pixelWidthMm - first.leadOutMm
            : (first.span.lastX + 1) * pixelWidthMm + first.leadOutMm;
          const entry = reverse
            ? (second.span.lastX + 1) * pixelWidthMm + second.leadInMm
            : second.span.firstX * pixelWidthMm - second.leadInMm;
          expect((entry - exit) * (reverse ? -1 : 1)).toBeGreaterThanOrEqual(-1e-9);
        },
      ),
    );
  });
});
