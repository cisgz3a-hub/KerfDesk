import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACE_OPTIONS, type TraceOptions } from './trace-image';
import {
  SUPERSAMPLE_TAPER_START,
  TRACE_WORKING_PIXEL_BUDGETS,
  fitsTraceWorkingPixelBudget,
  taperedSupersampleFactor,
  traceWorkingPixelBudget,
} from './trace-work-budget';

describe('trace working-pixel budgets', () => {
  it('assigns lower bounds to allocation-heavy edge and centerline backends', () => {
    expect(traceWorkingPixelBudget({ ...DEFAULT_TRACE_OPTIONS, traceMode: 'edge' })).toBe(
      TRACE_WORKING_PIXEL_BUDGETS.edge,
    );
    expect(traceWorkingPixelBudget({ ...DEFAULT_TRACE_OPTIONS, traceMode: 'centerline' })).toBe(
      TRACE_WORKING_PIXEL_BUDGETS.centerline,
    );
    expect(traceWorkingPixelBudget(DEFAULT_TRACE_OPTIONS)).toBe(
      TRACE_WORKING_PIXEL_BUDGETS.contour,
    );
  });

  it('measures the effective raster after supersampling, not source pixels', () => {
    const contour: TraceOptions = { ...DEFAULT_TRACE_OPTIONS };
    const edge: TraceOptions = { ...DEFAULT_TRACE_OPTIONS, traceMode: 'edge' };

    expect(fitsTraceWorkingPixelBudget({ width: 1500, height: 1000 }, 2, contour)).toBe(true);
    expect(fitsTraceWorkingPixelBudget({ width: 1501, height: 1000 }, 2, contour)).toBe(false);
    expect(fitsTraceWorkingPixelBudget({ width: 1000, height: 1000 }, 2, edge)).toBe(true);
    expect(fitsTraceWorkingPixelBudget({ width: 1001, height: 1000 }, 2, edge)).toBe(false);
  });

  it.each([
    ['0.5 MP sparse line art', 1000, 500, 3, true],
    ['0.5 MP over-scaled line art', 1000, 500, 4, false],
    ['1.9 MP dense ink', 1600, 1200, 2, false],
    ['5 MP noisy scan at native scale', 2500, 2000, 1, true],
    ['6 MP cap boundary at native scale', 3000, 2000, 1, true],
  ] as const)(
    '%s has an explicit effective-work decision',
    (_label, width, height, factor, fits) => {
      expect(fitsTraceWorkingPixelBudget({ width, height }, factor, DEFAULT_TRACE_OPTIONS)).toBe(
        fits,
      );
    },
  );
});

describe('supersample taper at the budget edge', () => {
  const contour: TraceOptions = { ...DEFAULT_TRACE_OPTIONS };
  const square = (side: number) => ({ width: side, height: side });
  // Working pixels the policy would trace a side x side source on for a
  // requested 2x: the exact 2x grid, the taper, or native past the budget.
  const workAt = (side: number, options: TraceOptions): number => {
    const tapered = taperedSupersampleFactor(square(side), 2, options);
    const fits = fitsTraceWorkingPixelBudget(square(side), 2, options);
    const factor = tapered ?? (fits ? 2 : 1);
    return side * side * factor * factor;
  };

  it('keeps the exact 2x grid below the band and leaves other factors alone', () => {
    const below = Math.floor(
      Math.sqrt((TRACE_WORKING_PIXEL_BUDGETS.contour / 4) * SUPERSAMPLE_TAPER_START),
    );
    expect(taperedSupersampleFactor(square(below), 2, contour)).toBeNull();
    expect(taperedSupersampleFactor(square(1200), 3, contour)).toBeNull();
    expect(taperedSupersampleFactor(square(1200), 1, contour)).toBeNull();
    expect(taperedSupersampleFactor(square(1225), 2, contour)).toBeNull();
  });

  it('eases from 2x toward native through the band instead of a 4x step', () => {
    // The old policy traced 1224² on 5.99M pixels and 1225² on 1.50M.
    const inBand = taperedSupersampleFactor(square(1150), 2, contour);
    expect(inBand).toBeGreaterThan(1);
    expect(inBand).toBeLessThan(2);
    for (const options of [contour, { ...contour, traceMode: 'edge' as const }]) {
      for (let side = 900; side < 1400; side += 1) {
        const step = workAt(side, options) / workAt(side + 1, options);
        expect(Math.max(step, 1 / step)).toBeLessThanOrEqual(1.25);
      }
    }
  });
});
