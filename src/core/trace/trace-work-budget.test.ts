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
});
