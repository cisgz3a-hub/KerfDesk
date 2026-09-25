// Edge Detection's operator contract (ADR-412): every Sensitivity and Detail
// stop the dialog offers is its own detector setting, and options saved by
// older builds (Canny-era fields, the palette/Otsu/despeckle entries the
// preset used to carry) still load and trace exactly as before.

import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, type RawImageData, type TraceOptions } from '../../core/trace';
import {
  edgeContrastDelta,
  edgeSourceRadiusPx,
  prepareEdgeTraceInput,
} from '../../core/trace/edge-input';
import { traceImageToColoredPaths } from '../../core/trace/trace-to-paths';
import {
  EDGE_DETAIL_STEP,
  EDGE_SENSITIVITY_STEP,
  edgeDetailFromOptions,
  edgeSensitivityFromOptions,
  mergeLightBurnTraceSettings,
  type LightBurnTraceSettingOverrides,
} from './trace-options';

const EDGE = TRACE_PRESETS['Edge Detection'] as TraceOptions;

// Options as the Edge preset and dialog wrote them before ADR-412.
const LEGACY_EDGE: TraceOptions = {
  ...EDGE,
  fixedPalette: ['#ffffff', '#000000'],
  useOtsuThreshold: true,
  despeckleMinPixels: 12,
  edgeHighThresholdRatio: 0.2,
  edgeJoinGapPx: 5,
};

function stops(step: number): number[] {
  const values: number[] = [];
  for (let value = 0; value <= 100; value += step) values.push(value);
  return values;
}

// Valleys whose curvature grows down the image: a pixel reads darker than
// its neighbourhood mean by curvature x r(r+1)/3, so each row switches to ink
// at its own contrast delta and its own radius. Every level stays above the
// global 128 cut, so only the local test decides.
function curvatureGradient(): RawImageData {
  const width = 72;
  const height = 160;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const curvature = 0.015 * 100 ** (y / (height - 1));
    for (let x = 0; x < width; x += 1) {
      const luma = Math.min(250, 140 + curvature * (x - width / 2) ** 2);
      data.set([luma, luma, luma, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function mask(image: RawImageData, settings: LightBurnTraceSettingOverrides): Uint8Array {
  const options = mergeLightBurnTraceSettings(EDGE, settings);
  return prepareEdgeTraceInput(image, { ...options, edgeMedianFilter: false }).bitmap.data;
}

function inkCount(data: Uint8Array): number {
  return data.reduce((sum, value) => sum + value, 0);
}

describe('Edge Detection slider stops', () => {
  it('gives every offered Sensitivity stop its own mask on a gradient', () => {
    const image = curvatureGradient();
    const values = stops(EDGE_SENSITIVITY_STEP);
    expect(values).toHaveLength(11);
    const masks = values.map((edgeSensitivity) => mask(image, { edgeSensitivity }));
    expect(new Set(masks.map((m) => m.join(''))).size).toBe(values.length);
    // Higher Sensitivity keeps strictly more of the faint valleys.
    const counts = masks.map(inkCount);
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1] ?? Infinity);
    }
    // The whole 2..12 contrast range is reachable, one delta per stop.
    const deltas = values.map((edgeSensitivity) =>
      edgeContrastDelta(mergeLightBurnTraceSettings(EDGE, { edgeSensitivity })),
    );
    expect(deltas).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });

  it('gives every offered Detail stop its own mask on a gradient', () => {
    const image = curvatureGradient();
    const values = stops(EDGE_DETAIL_STEP);
    expect(values).toHaveLength(21);
    const masks = values.map((edgeDetail) => mask(image, { edgeDetail }));
    expect(new Set(masks.map((m) => m.join(''))).size).toBe(values.length);
    const radii = values.map((edgeDetail) =>
      edgeSourceRadiusPx(mergeLightBurnTraceSettings(EDGE, { edgeDetail })),
    );
    expect(radii).toEqual(values.map((_, index) => 24 - index));
  });

  it('shows each stop back as itself and a value between stops as its nearest stop', () => {
    for (const edgeSensitivity of stops(EDGE_SENSITIVITY_STEP)) {
      const merged = mergeLightBurnTraceSettings(EDGE, { edgeSensitivity });
      expect(edgeSensitivityFromOptions(merged)).toBe(edgeSensitivity);
    }
    for (const edgeDetail of stops(EDGE_DETAIL_STEP)) {
      const merged = mergeLightBurnTraceSettings(EDGE, { edgeDetail });
      expect(edgeDetailFromOptions(merged)).toBe(edgeDetail);
    }
    expect(mergeLightBurnTraceSettings(EDGE, { edgeSensitivity: 44 })).toEqual(
      mergeLightBurnTraceSettings(EDGE, { edgeSensitivity: 40 }),
    );
    expect(mergeLightBurnTraceSettings(EDGE, { edgeDetail: 62 })).toEqual(
      mergeLightBurnTraceSettings(EDGE, { edgeDetail: 60 }),
    );
  });
});

describe('Edge Detection legacy options', () => {
  it('keeps the detector setting every older stored ratio produced', () => {
    // Values the pre-ADR-412 dialog wrote at Sensitivity 0, the preset, and 100.
    expect(edgeContrastDelta({ ...EDGE, edgeLowThresholdRatio: 0.128 })).toBe(10);
    expect(edgeContrastDelta({ ...EDGE, edgeLowThresholdRatio: 0.08 })).toBe(6);
    expect(edgeContrastDelta({ ...EDGE, edgeLowThresholdRatio: 0.02 })).toBe(2);
    // Detail 0 and 100 wrote blur 2.5 and 0.6.
    expect(edgeSourceRadiusPx({ ...EDGE, edgeBlurSigma: 2.5 })).toBe(25);
    expect(edgeSourceRadiusPx({ ...EDGE, edgeBlurSigma: 0.6 })).toBe(6);
    // A radius beyond the dialog's range shows at the nearest end.
    expect(edgeDetailFromOptions({ ...EDGE, edgeBlurSigma: 2.5 })).toBe(0);
  });

  it('loads older saved options and traces them exactly as the current preset', async () => {
    const image = curvatureGradient();
    expect(edgeSensitivityFromOptions(LEGACY_EDGE)).toBe(edgeSensitivityFromOptions(EDGE));
    expect(edgeDetailFromOptions(LEGACY_EDGE)).toBe(edgeDetailFromOptions(EDGE));
    const current = await traceImageToColoredPaths(image, EDGE);
    expect(current.flatMap((path) => path.polylines).length).toBeGreaterThan(0);
    expect(await traceImageToColoredPaths(image, LEGACY_EDGE)).toEqual(current);
    // The dialog still layers new stops over a legacy object.
    const merged = mergeLightBurnTraceSettings(LEGACY_EDGE, { edgeSensitivity: 100 });
    expect(edgeContrastDelta(merged)).toBe(2);
    expect(merged.edgeHighThresholdRatio).toBe(0.2);
  });

  it('no longer carries entries the detector never reads in the preset', () => {
    for (const key of [
      'fixedPalette',
      'useOtsuThreshold',
      'despeckleMinPixels',
      'edgeHighThresholdRatio',
      'edgeJoinGapPx',
    ]) {
      expect(EDGE).not.toHaveProperty(key);
    }
  });
});
