// Unit coverage for the three pure-data helpers. Each is a small
// transform, but they govern user-visible behaviour (presets layering,
// retry-on-empty), so explicit invariants here are cheap insurance.

import { describe, expect, it } from 'vitest';

import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { DEFAULT_ADJUSTMENTS, type AdjustmentValues } from './AdjustmentControls';
import {
  hasAggressivePreprocessing,
  mergeLightBurnTraceSettings,
  mergeAdjustments,
  relaxAggressivePreprocessing,
} from './trace-options';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;
const SMOOTH = TRACE_PRESETS['Smooth'] as TraceOptions;
// A photo-like multi-colour options object (the shape the removed "Photo"
// preset had). Kept inline so mergeLightBurnTraceSettings behaviour on a
// non-fixedPalette options object stays covered after Photo/Detailed were
// dropped as surfaced presets (vector Trace is binary, ADR-043).
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

describe('mergeAdjustments', () => {
  it('returns an options object equivalent to the preset when adjustments are at defaults', () => {
    const merged = mergeAdjustments(LINE_ART, DEFAULT_ADJUSTMENTS);
    // Every preset field should round-trip — same values, including
    // the readonly tuple-ish fixedPalette.
    expect(merged.numberOfColors).toBe(LINE_ART.numberOfColors);
    expect(merged.useOtsuThreshold).toBe(LINE_ART.useOtsuThreshold);
    expect(merged.fixedPalette).toEqual(LINE_ART.fixedPalette);
    expect(merged.despeckleMinPixels).toBe(LINE_ART.despeckleMinPixels);
    // None of the adjustment fields should be added when neutral.
    expect((merged as Record<string, unknown>)['brightness']).toBeUndefined();
    expect((merged as Record<string, unknown>)['contrast']).toBeUndefined();
    expect((merged as Record<string, unknown>)['gamma']).toBeUndefined();
    expect((merged as Record<string, unknown>)['invert']).toBeUndefined();
    expect((merged as Record<string, unknown>)['ditherMode']).toBeUndefined();
  });

  it('layers each non-neutral adjustment field', () => {
    const adj: AdjustmentValues = {
      brightness: 25,
      contrast: -30,
      gamma: 1.4,
      invert: true,
      ditherMode: 'floyd-steinberg',
    };
    const merged = mergeAdjustments(LINE_ART, adj);
    expect(merged.brightness).toBe(25);
    expect(merged.contrast).toBe(-30);
    expect(merged.gamma).toBe(1.4);
    expect(merged.invert).toBe(true);
    expect(merged.ditherMode).toBe('floyd-steinberg');
    // Preset fields still survive.
    expect(merged.useOtsuThreshold).toBe(LINE_ART.useOtsuThreshold);
  });

  it('omits brightness when 0 (so the no-op early return in raster-prep fires)', () => {
    const merged = mergeAdjustments(LINE_ART, { ...DEFAULT_ADJUSTMENTS, contrast: 10 });
    expect((merged as Record<string, unknown>)['brightness']).toBeUndefined();
    expect(merged.contrast).toBe(10);
  });

  it('does not mutate the input preset', () => {
    const presetSnapshot = JSON.stringify(LINE_ART);
    mergeAdjustments(LINE_ART, { ...DEFAULT_ADJUSTMENTS, brightness: 50, invert: true });
    expect(JSON.stringify(LINE_ART)).toBe(presetSnapshot);
  });
});

describe('mergeLightBurnTraceSettings', () => {
  it('layers changed LightBurn trace controls onto the preset', () => {
    const merged = mergeLightBurnTraceSettings(LINE_ART, {
      cutoffLuma: 12,
      thresholdLuma: 160,
      ignoreLessThanPixels: 7,
      smoothness: 0.4,
      optimize: 0.6,
    });

    expect(merged.cutoffLuma).toBe(12);
    expect(merged.thresholdLuma).toBe(160);
    expect(merged.ignoreLessThanPixels).toBe(7);
    expect(merged.despeckleMinPixels).toBe(7);
    expect(merged.smoothness).toBe(0.4);
    expect(merged.optimize).toBe(0.6);
    expect(merged.fixedPalette).toEqual(LINE_ART.fixedPalette);
  });

  it('does not force binary LightBurn threshold fields onto untouched multi-colour options', () => {
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
    // Line Art ships pathOmit: 16, which on small / simple shapes
    // (logos, text glyphs) drops everything. The retry should keep
    // any path with content.
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
    // Round-trip invariant — relaxing should always disarm the
    // predicate, otherwise the retry loop in the dialog would spin.
    const relaxed = relaxAggressivePreprocessing(LINE_ART);
    expect(hasAggressivePreprocessing(relaxed)).toBe(false);
  });
});
