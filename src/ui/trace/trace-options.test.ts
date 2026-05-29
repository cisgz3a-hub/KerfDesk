// Unit coverage for the three pure-data helpers. Each is a small
// transform, but they govern user-visible behaviour (presets layering,
// retry-on-empty), so explicit invariants here are cheap insurance.

import { describe, expect, it } from 'vitest';

import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { DEFAULT_ADJUSTMENTS, type AdjustmentValues } from './AdjustmentControls';
import {
  hasAggressivePreprocessing,
  mergeAdjustments,
  relaxAggressivePreprocessing,
} from './trace-options';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;

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
