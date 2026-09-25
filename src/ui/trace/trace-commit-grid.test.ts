import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { TRACE_PRESETS } from '../../core/trace';
import { PREVIEW_MAX_EDGE_PX, scaleToCap } from './trace-decode-cap';
import {
  DEFAULT_DEVICE_MEMORY_GB,
  TRACE_MAX_WORKING_PIXELS,
  TRACE_MEMORY_SHARE,
  TRACE_PEAK_BYTES_PER_PIXEL,
  commitGridExceedsPreview,
  describeTraceCommitGrid,
  planTraceCommitGrid,
  planTraceCommitGridFor,
  rasterOutputMm,
  traceCommitPixelBudget,
  traceOptionsForCommitGrid,
  traceTargetPxPerMm,
} from './trace-commit-grid';

const LINE_ART = TRACE_PRESETS['Line Art']!;
const GIB = 2 ** 30;

describe('traceTargetPxPerMm', () => {
  it('samples the laser spot twice on its finer axis', () => {
    const device = { laserSubProfile: { spotSizeMm: { x: 0.16, y: 0.18 } } };
    expect(traceTargetPxPerMm(device as never, 'laser')).toBeCloseTo(12.5, 9);
  });

  it('uses the documented 0.1 mm default spot when none is known, and for CNC', () => {
    expect(traceTargetPxPerMm(undefined, 'laser')).toBe(20);
    const device = { laserSubProfile: { spotSizeMm: { x: 0.05, y: 0.05 } } };
    expect(traceTargetPxPerMm(device as never, 'cnc')).toBe(20);
  });

  it('skips an unusable spot axis instead of trusting it', () => {
    const device = { laserSubProfile: { spotSizeMm: { x: 0, y: 0.2 } } };
    expect(traceTargetPxPerMm(device as never, 'laser')).toBeCloseTo(10, 9);
  });
});

describe('traceCommitPixelBudget (memory guard)', () => {
  it.each([0.5, 2, 4, 8])('keeps the planned peak within the memory share of %s GB', (gb) => {
    for (const traceMode of ['filled-contours', 'edge', 'centerline'] as const) {
      const budget = traceCommitPixelBudget({ traceMode }, gb);
      const lane = traceMode === 'filled-contours' ? 'contour' : traceMode;
      const peak = budget * TRACE_PEAK_BYTES_PER_PIXEL[lane];
      expect(peak).toBeLessThanOrEqual(gb * GIB * TRACE_MEMORY_SHARE);
      expect(budget).toBeLessThanOrEqual(TRACE_MAX_WORKING_PIXELS);
    }
  });

  it('assumes the default device memory when the browser does not report it', () => {
    expect(traceCommitPixelBudget(LINE_ART, undefined)).toBe(
      traceCommitPixelBudget(LINE_ART, DEFAULT_DEVICE_MEMORY_GB),
    );
    expect(traceCommitPixelBudget(LINE_ART, Number.NaN)).toBe(
      traceCommitPixelBudget(LINE_ART, DEFAULT_DEVICE_MEMORY_GB),
    );
  });

  it('plans Edge Detection, the hungriest lane, on fewer pixels', () => {
    expect(traceCommitPixelBudget({ traceMode: 'edge' }, 8)).toBeLessThan(
      traceCommitPixelBudget(LINE_ART, 8),
    );
  });
});

describe('planTraceCommitGrid', () => {
  it('traces a wide 4096 x 512 source at native size where the preview halves it', () => {
    const plan = planTraceCommitGrid({
      native: { width: 4096, height: 512 },
      outputMm: { width: 409.6, height: 51.2 },
      targetPxPerMm: 20,
      pixelBudget: traceCommitPixelBudget(LINE_ART, 8),
    });
    expect(plan.preview).toEqual({ width: 2048, height: 256 });
    expect(plan.grid).toEqual({ width: 4096, height: 512 });
    expect(plan.limit).toBe('native');
    expect(commitGridExceedsPreview(plan)).toBe(true);
  });

  it.each([undefined, 4, 8])(
    'keeps a 6000 x 4000 source inside the pixel budget (device memory %s GB)',
    (gb) => {
      const pixelBudget = traceCommitPixelBudget(LINE_ART, gb);
      const plan = planTraceCommitGrid({
        native: { width: 6000, height: 4000 },
        outputMm: { width: 600, height: 400 },
        targetPxPerMm: 20,
        pixelBudget,
      });
      expect(plan.limit).toBe('memory');
      expect(plan.grid.width * plan.grid.height).toBeLessThanOrEqual(pixelBudget);
      // Largest grid that fits: one more pixel on the long edge would not.
      const next = scaleToCap(6000, 4000, plan.maxEdge + 1);
      expect(next.width * next.height).toBeGreaterThan(pixelBudget);
      expect(plan.grid.width).toBeGreaterThan(plan.preview.width);
      expect(plan.grid.width / plan.grid.height).toBeCloseTo(1.5, 2);
    },
  );

  it('stops at the density the placed output can use', () => {
    // 6000 px placed 150 mm wide at 20 px/mm needs 3000 px.
    const plan = planTraceCommitGrid({
      native: { width: 6000, height: 4000 },
      outputMm: { width: 150, height: 100 },
      targetPxPerMm: 20,
      pixelBudget: 100_000_000,
    });
    expect(plan.limit).toBe('output');
    expect(plan.grid).toEqual({ width: 3000, height: 2000 });
  });

  it('never goes coarser than the preview the operator approved', () => {
    const small = planTraceCommitGrid({
      native: { width: 6000, height: 4000 },
      outputMm: { width: 20, height: 13.3 },
      targetPxPerMm: 20,
      pixelBudget: 100_000_000,
    });
    expect(small.limit).toBe('preview');
    expect(small.grid).toEqual(small.preview);
    const starved = planTraceCommitGrid({
      native: { width: 6000, height: 4000 },
      outputMm: null,
      targetPxPerMm: 20,
      pixelBudget: 1_000,
    });
    expect(starved.grid).toEqual({ width: PREVIEW_MAX_EDGE_PX, height: 1365 });
    expect(commitGridExceedsPreview(starved)).toBe(false);
  });

  it('leaves a source within the preview cap on its own grid', () => {
    const plan = planTraceCommitGrid({
      native: { width: 1254, height: 1254 },
      outputMm: { width: 125.4, height: 125.4 },
      targetPxPerMm: 20,
      pixelBudget: 100_000_000,
    });
    expect(plan.grid).toEqual({ width: 1254, height: 1254 });
    expect(commitGridExceedsPreview(plan)).toBe(false);
  });

  it('keeps Photo shading on the preview grid', () => {
    const context = { outputMm: null, targetPxPerMm: 20, deviceMemoryGb: 8 };
    const photo = TRACE_PRESETS['Photo shading']!;
    expect(planTraceCommitGridFor({ width: 6000, height: 4000 }, context, photo)).toBeNull();
    expect(planTraceCommitGridFor({ width: 6000, height: 4000 }, context, LINE_ART)).not.toBeNull();
  });
});

describe('rasterOutputMm', () => {
  it('reads the placed size from bounds and scale, whatever the mirror', () => {
    const size = rasterOutputMm({
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      transform: { ...IDENTITY_TRANSFORM, scaleX: -2, scaleY: 0.5 },
    });
    expect(size).toEqual({ width: 200, height: 25 });
  });
});

describe('traceOptionsForCommitGrid', () => {
  it('keeps the preview-grid meaning of the size controls on a 2x grid', () => {
    const options = {
      ...LINE_ART,
      edgeMinLengthPx: 10,
      centerlineJoinGapPx: 3,
      edgeJoinGapPx: 4,
    };
    const scaled = traceOptionsForCommitGrid(options, {
      grid: { width: 4096, height: 512 },
      preview: { width: 2048, height: 256 },
    });
    expect(scaled.despeckleMinPixels).toBe((LINE_ART.despeckleMinPixels ?? 0) * 4);
    expect(scaled.ignoreLessThanPixels).toBe((LINE_ART.ignoreLessThanPixels ?? 0) * 4);
    expect(scaled.edgeMinLengthPx).toBe(20);
    expect(scaled.centerlineJoinGapPx).toBe(6);
    expect(scaled.edgeJoinGapPx).toBe(8);
    // Fitting tolerances stay one working pixel: that is the gained fidelity.
    expect(scaled.lineTolerance).toBe(LINE_ART.lineTolerance);
    expect(scaled.smoothness).toBe(LINE_ART.smoothness);
    expect(scaled.pixelScale).toBeUndefined();
  });

  it('returns the same options object on the preview grid', () => {
    const grid = { width: 1000, height: 800 };
    expect(traceOptionsForCommitGrid(LINE_ART, { grid, preview: grid })).toBe(LINE_ART);
  });
});

describe('describeTraceCommitGrid', () => {
  it('tells the operator the committed trace is finer than the preview', () => {
    const plan = planTraceCommitGrid({
      native: { width: 4096, height: 512 },
      outputMm: null,
      targetPxPerMm: 20,
      pixelBudget: 100_000_000,
    });
    expect(describeTraceCommitGrid(plan)).toBe(
      'Preview: 2048 x 256 px. The committed trace uses 4096 x 512 px (the full image), so it can keep detail the preview cannot show.',
    );
  });

  it('names the memory limit and the full size when the budget binds', () => {
    const plan = planTraceCommitGrid({
      native: { width: 6000, height: 4000 },
      outputMm: null,
      targetPxPerMm: 20,
      pixelBudget: 6_000_000,
    });
    expect(describeTraceCommitGrid(plan)).toContain("this device's memory");
    expect(describeTraceCommitGrid(plan)).toContain('6000 x 4000 px');
  });

  it('says nothing when the commit traces the preview grid', () => {
    const plan = planTraceCommitGrid({
      native: { width: 800, height: 600 },
      outputMm: null,
      targetPxPerMm: 20,
      pixelBudget: 100_000_000,
    });
    expect(describeTraceCommitGrid(plan)).toBeNull();
  });
});
