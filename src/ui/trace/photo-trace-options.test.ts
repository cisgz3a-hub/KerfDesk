import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, isBinaryContourPreset } from '../../core/trace';
import { hasAggressivePreprocessing, mergeLightBurnTraceSettings } from './trace-options';

const PHOTO = TRACE_PRESETS['Photo shading']!;

describe('photo shading settings', () => {
  it('keeps midtones when switching from a manually adjusted binary preset', () => {
    const options = mergeLightBurnTraceSettings(PHOTO, {
      detectionMode: 'manual',
      thresholdLuma: 64,
      cutoffLuma: 12,
      traceTransparency: true,
      sketchTrace: true,
      despeckleMinPixels: 100,
      ignoreLessThanPixels: 100,
      smoothness: 1.3,
      optimize: 2,
    });
    expect(options).toEqual({ ...PHOTO, gamma: 1 });
    expect(isBinaryContourPreset(options)).toBe(false);
    expect(hasAggressivePreprocessing(options)).toBe(false);
  });

  it('isolates photo adjustments when returning to a line-art preset', () => {
    const settings = {
      photoDetail: 95,
      photoBrightness: 20,
      photoContrast: -40,
      photoGamma: 1.8,
      photoInvert: true,
    };
    expect(mergeLightBurnTraceSettings(PHOTO, settings)).toMatchObject({
      photoDetail: 95,
      brightness: 20,
      contrast: -40,
      gamma: 1.8,
      invert: true,
    });
    expect(mergeLightBurnTraceSettings(TRACE_PRESETS['Line Art']!, settings)).toEqual(
      TRACE_PRESETS['Line Art'],
    );
  });

  it('clamps finite adjustments and restores defaults for invalid input', () => {
    expect(
      mergeLightBurnTraceSettings(PHOTO, {
        photoDetail: 150,
        photoBrightness: -500,
        photoContrast: 200,
        photoGamma: 20,
      }),
    ).toMatchObject({ photoDetail: 100, brightness: -100, contrast: 100, gamma: 5 });
    expect(
      mergeLightBurnTraceSettings(PHOTO, {
        photoDetail: Number.NaN,
        photoBrightness: Number.POSITIVE_INFINITY,
        photoContrast: Number.NEGATIVE_INFINITY,
        photoGamma: Number.NaN,
      }),
    ).toEqual({ ...PHOTO, gamma: 1 });
    expect(mergeLightBurnTraceSettings(PHOTO, { photoGamma: -1 }).gamma).toBe(0.1);
  });

  it('starts from a neutral gamma and no inversion, and lets the preset set them', () => {
    expect(PHOTO).toMatchObject({ gamma: 1, invert: false });
    expect(mergeLightBurnTraceSettings(PHOTO, {})).toEqual(PHOTO);
    const custom = { ...PHOTO, gamma: 1.3, invert: true };
    expect(mergeLightBurnTraceSettings(custom, {})).toMatchObject({ gamma: 1.3, invert: true });
    expect(mergeLightBurnTraceSettings(custom, { photoInvert: false })).toMatchObject({
      invert: false,
    });
  });
});
