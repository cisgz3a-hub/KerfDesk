import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIGHTBURN_TRACE_SETTINGS,
  lightBurnTraceSettingsToPotraceParams,
} from './potrace-params';

describe('lightBurnTraceSettingsToPotraceParams', () => {
  it('maps LightBurn documented defaults to Potrace defaults', () => {
    expect(DEFAULT_LIGHTBURN_TRACE_SETTINGS).toEqual({
      cutoffLuma: 0,
      thresholdLuma: 128,
      ignoreLessThanPixels: 2,
      smoothness: 1,
      optimize: 0.2,
      traceTransparency: false,
      sketchTrace: false,
    });

    expect(lightBurnTraceSettingsToPotraceParams(DEFAULT_LIGHTBURN_TRACE_SETTINGS)).toEqual({
      turdSize: 2,
      turnPolicy: 'minority',
      alphaMax: 1,
      optCurve: true,
      optTolerance: 0.2,
    });
  });

  it('uses Smoothness directly as Potrace alphamax and clamps to the useful range', () => {
    expect(lightBurnTraceSettingsToPotraceParams({ smoothness: 0 }).alphaMax).toBe(0);
    expect(lightBurnTraceSettingsToPotraceParams({ smoothness: 1.333 }).alphaMax).toBe(1.333);
    expect(lightBurnTraceSettingsToPotraceParams({ smoothness: -1 }).alphaMax).toBe(0);
    expect(lightBurnTraceSettingsToPotraceParams({ smoothness: 2 }).alphaMax).toBeCloseTo(4 / 3);
  });

  it('turns Optimize 0 into Potrace long-curve mode and otherwise uses opttolerance', () => {
    expect(lightBurnTraceSettingsToPotraceParams({ optimize: 0 })).toMatchObject({
      optCurve: false,
      optTolerance: 0,
    });
    expect(lightBurnTraceSettingsToPotraceParams({ optimize: 0.85 })).toMatchObject({
      optCurve: true,
      optTolerance: 0.85,
    });
  });

  it('maps Ignore Less Than directly to Potrace turdsize', () => {
    expect(lightBurnTraceSettingsToPotraceParams({ ignoreLessThanPixels: 0 }).turdSize).toBe(0);
    expect(lightBurnTraceSettingsToPotraceParams({ ignoreLessThanPixels: 12.8 }).turdSize).toBe(13);
    expect(lightBurnTraceSettingsToPotraceParams({ ignoreLessThanPixels: -4 }).turdSize).toBe(0);
  });
});
