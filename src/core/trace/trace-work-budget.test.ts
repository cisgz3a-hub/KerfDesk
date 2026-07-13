import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACE_OPTIONS, type TraceOptions } from './trace-image';
import {
  TRACE_WORKING_PIXEL_BUDGETS,
  fitsTraceWorkingPixelBudget,
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
