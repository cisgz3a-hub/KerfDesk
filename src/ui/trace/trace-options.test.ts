// Unit coverage for the pure-data helpers. Each is a small transform,
// but they govern visible Trace Image behavior, so explicit invariants
// here are cheap insurance.

import { describe, expect, it } from 'vitest';

import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import {
  hasAggressivePreprocessing,
  mergeLightBurnTraceSettings,
  relaxAggressivePreprocessing,
} from './trace-options';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;
const SMOOTH = TRACE_PRESETS['Smooth'] as TraceOptions;
// A photo-like multi-color options object. Kept inline so
// mergeLightBurnTraceSettings behavior on a non-fixedPalette options
// object stays covered after Photo/Detailed were dropped as surfaced
// presets because vector Trace is binary.
const PHOTO: TraceOptions = {
  numberOfColors: 8,
  pathOmit: 8,
  lineTolerance: 1.5,
  quadraticTolerance: 1.5,
  blurRadius: 3,
  blurDelta: 30,
  lineFilter: true,
  medianFilter: true,
};

describe('mergeLightBurnTraceSettings', () => {
  it('layers changed LightBurn trace controls onto the preset', () => {
    const merged = mergeLightBurnTraceSettings(LINE_ART, {
      cutoffLuma: 12,
      thresholdLuma: 160,
      ignoreLessThanPixels: 7,
      smoothness: 0.4,
      optimize: 0.6,
      traceTransparency: true,
      sketchTrace: true,
    });

    expect(merged.cutoffLuma).toBe(12);
    expect(merged.thresholdLuma).toBe(160);
    expect(merged.ignoreLessThanPixels).toBe(7);
    expect(merged.despeckleMinPixels).toBe(7);
    expect(merged.smoothness).toBe(0.4);
    expect(merged.optimize).toBe(0.6);
    expect(merged.traceTransparency).toBe(true);
    expect(merged.sketchTrace).toBe(true);
    expect(merged.fixedPalette).toEqual(LINE_ART.fixedPalette);
  });

  it('does not force binary LightBurn threshold fields onto untouched multi-color options', () => {
    const merged = mergeLightBurnTraceSettings(PHOTO, {});
    expect(merged.cutoffLuma).toBeUndefined();
    expect(merged.thresholdLuma).toBeUndefined();
    expect(merged.ignoreLessThanPixels).toBeUndefined();
    expect(merged.despeckleMinPixels).toBe(PHOTO.despeckleMinPixels);
    expect(merged.numberOfColors).toBe(PHOTO.numberOfColors);
  });

  it('makes manual Cutoff/Threshold overrides authoritative over Otsu presets', () => {
    expect(SMOOTH.useOtsuThreshold).toBe(true);

    const merged = mergeLightBurnTraceSettings(SMOOTH, {
      cutoffLuma: 24,
      thresholdLuma: 160,
    });

    expect(merged.useOtsuThreshold).toBeUndefined();
    expect(merged.cutoffLuma).toBe(24);
    expect(merged.thresholdLuma).toBe(160);
  });

  it('keeps Otsu enabled when non-threshold trace controls change', () => {
    expect(SMOOTH.useOtsuThreshold).toBe(true);

    const merged = mergeLightBurnTraceSettings(SMOOTH, {
      ignoreLessThanPixels: 12,
      smoothness: 0.8,
      optimize: 0.3,
    });

    expect(merged.useOtsuThreshold).toBe(true);
  });
});

describe('hasAggressivePreprocessing', () => {
  it('is true for Line Art (uses Otsu + fixedPalette + despeckle)', () => {
    expect(hasAggressivePreprocessing(LINE_ART)).toBe(true);
  });

  it('is false for an options object with none of the three levers', () => {
    const bare: TraceOptions = {
      numberOfColors: 2,
      pathOmit: 8,
      lineTolerance: 1,
      quadraticTolerance: 1,
      blurRadius: 0,
      blurDelta: 0,
      lineFilter: true,
    };
    expect(hasAggressivePreprocessing(bare)).toBe(false);
  });

  it('is true when only despeckle is enabled (above 1)', () => {
    const bare: TraceOptions = {
      numberOfColors: 2,
      pathOmit: 8,
      lineTolerance: 1,
      quadraticTolerance: 1,
      blurRadius: 0,
      blurDelta: 0,
      lineFilter: true,
      despeckleMinPixels: 4,
    };
    expect(hasAggressivePreprocessing(bare)).toBe(true);
  });

  it('is false when despeckle is 0 or 1 (no-op values)', () => {
    const bare: TraceOptions = {
      numberOfColors: 2,
      pathOmit: 8,
      lineTolerance: 1,
      quadraticTolerance: 1,
      blurRadius: 0,
      blurDelta: 0,
      lineFilter: true,
      despeckleMinPixels: 1,
    };
    expect(hasAggressivePreprocessing(bare)).toBe(false);
  });
});

describe('relaxAggressivePreprocessing', () => {
  it('drops the three aggressive fields entirely', () => {
    const relaxed = relaxAggressivePreprocessing(LINE_ART);
    expect((relaxed as Record<string, unknown>)['useOtsuThreshold']).toBeUndefined();
    expect((relaxed as Record<string, unknown>)['fixedPalette']).toBeUndefined();
    expect((relaxed as Record<string, unknown>)['despeckleMinPixels']).toBeUndefined();
  });

  it('forces pathOmit to 0 so the retry keeps every path imagetracerjs emits', () => {
    expect(LINE_ART.pathOmit).toBe(16);
    const relaxed = relaxAggressivePreprocessing(LINE_ART);
    expect(relaxed.pathOmit).toBe(0);
  });

  it('preserves every non-aggressive preset field unchanged', () => {
    const relaxed = relaxAggressivePreprocessing(LINE_ART);
    expect(relaxed.numberOfColors).toBe(LINE_ART.numberOfColors);
    expect(relaxed.lineTolerance).toBe(LINE_ART.lineTolerance);
    expect(relaxed.lineFilter).toBe(LINE_ART.lineFilter);
    expect(relaxed.blurRadius).toBe(LINE_ART.blurRadius);
    expect(relaxed.quadraticTolerance).toBe(LINE_ART.quadraticTolerance);
  });

  it('does not mutate the input options', () => {
    const snapshot = JSON.stringify(LINE_ART);
    relaxAggressivePreprocessing(LINE_ART);
    expect(JSON.stringify(LINE_ART)).toBe(snapshot);
  });

  it('returns hasAggressivePreprocessing() === false on its own output', () => {
    const relaxed = relaxAggressivePreprocessing(LINE_ART);
    expect(hasAggressivePreprocessing(relaxed)).toBe(false);
  });
});
