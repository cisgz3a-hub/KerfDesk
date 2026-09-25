import { describe, expect, it } from 'vitest';
import type { TraceSettingsRecord } from '../../core/scene';
import type { LightBurnTraceSettingOverrides } from './trace-options';
import { captureTraceSettings, restoreTraceSettings } from './trace-settings-snapshot';

const GRID = { width: 100, height: 80 };

function record(over: Partial<TraceSettingsRecord> = {}): TraceSettingsRecord {
  return { schemaVersion: 1, presetName: 'Line Art', overrides: {}, ...over };
}

describe('trace settings snapshot (ADR-400)', () => {
  it('restores exactly what it captured', () => {
    const captured = captureTraceSettings({
      presetName: 'Sharp',
      overrides: {
        detectionMode: 'manual',
        cutoffLuma: 10,
        thresholdLuma: 150,
        sketchTrace: false,
      },
      output: 'raster',
      fillStyle: 'island',
      boundary: { x: 5, y: 6, width: 20, height: 30 },
      boundaryMode: 'enhance',
    });
    expect(restoreTraceSettings(captured, GRID)).toEqual({
      presetName: 'Sharp',
      overrides: {
        detectionMode: 'manual',
        cutoffLuma: 10,
        thresholdLuma: 150,
        sketchTrace: false,
      },
      output: 'raster',
      fillStyle: 'island',
      boundary: { x: 5, y: 6, width: 20, height: 30 },
      boundaryMode: 'enhance',
    });
  });

  it('does not record a boundary mode without a boundary', () => {
    const captured = captureTraceSettings({
      presetName: 'Line Art',
      overrides: {},
      output: 'vector',
      fillStyle: 'scanline',
      boundary: null,
      boundaryMode: 'crop',
    });
    expect(captured).not.toHaveProperty('boundary');
    expect(captured).not.toHaveProperty('boundaryMode');
  });

  it('opens legacy traces on the defaults', () => {
    expect(restoreTraceSettings(undefined, GRID)).toEqual({});
  });

  it('keeps only known controls whose values have the control type', () => {
    const restored = restoreTraceSettings(
      record({
        overrides: {
          smoothness: 'high',
          optimize: 0.3,
          detectionMode: 'psychic',
          photoInvert: 1,
          traceTransparency: true,
          futureKnob: 4,
        },
      }),
      GRID,
    );
    expect(restored.overrides).toEqual({ optimize: 0.3, traceTransparency: true });
  });

  it('keeps the line presets Invert through capture and restore', () => {
    // `invert` is the Line-preset Invert control (ADR-396). It must persist
    // like every other control; the cast keeps this test valid on builds
    // where the override type does not list it yet.
    const overrides = { invert: true, smoothness: 0.8 } as LightBurnTraceSettingOverrides;
    const captured = captureTraceSettings({
      presetName: 'Line Art',
      overrides,
      output: 'vector',
      fillStyle: 'scanline',
      boundary: null,
      boundaryMode: 'crop',
    });
    expect(captured.overrides).toEqual({ invert: true, smoothness: 0.8 });
    expect(restoreTraceSettings(captured, GRID).overrides).toEqual({
      invert: true,
      smoothness: 0.8,
    });
    expect(restoreTraceSettings(record({ overrides: { invert: 'yes' } }), GRID).overrides).toEqual(
      {},
    );
  });

  it('fits restored numbers to the range the dialog control offers', () => {
    const restored = restoreTraceSettings(
      record({
        overrides: {
          smoothness: 1e6,
          despeckleMinPixels: 1e12,
          optimize: -4,
          photoGamma: 0,
          cutoffLuma: 12,
        },
      }),
      GRID,
    );
    expect(restored.overrides).toEqual({
      smoothness: 1.33,
      despeckleMinPixels: 10000,
      optimize: 0,
      photoGamma: 0.1,
      cutoffLuma: 12,
    });
  });

  it('falls back to the default preset for a preset this build does not offer', () => {
    expect(restoreTraceSettings(record({ presetName: 'Retired preset' }), GRID)).not.toHaveProperty(
      'presetName',
    );
  });

  it('fits the boundary to the source grid and drops one that no longer overlaps it', () => {
    const clamped = restoreTraceSettings(
      record({ boundary: { x: 90, y: 70, width: 40, height: 40 }, boundaryMode: 'enhance' }),
      GRID,
    );
    expect(clamped.boundary).toEqual({ x: 90, y: 70, width: 10, height: 10 });
    const outside = restoreTraceSettings(
      record({ boundary: { x: 200, y: 200, width: 5, height: 5 }, boundaryMode: 'enhance' }),
      GRID,
    );
    expect(outside).not.toHaveProperty('boundary');
    expect(outside).not.toHaveProperty('boundaryMode');
  });

  it('reopens a Photo shading boundary in Crop mode', () => {
    const restored = restoreTraceSettings(
      record({
        presetName: 'Photo shading',
        boundary: { x: 1, y: 1, width: 10, height: 10 },
        boundaryMode: 'enhance',
      }),
      GRID,
    );
    expect(restored.boundaryMode).toBe('crop');
  });
});
