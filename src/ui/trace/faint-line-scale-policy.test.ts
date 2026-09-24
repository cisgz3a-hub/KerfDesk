import { describe, expect, it } from 'vitest';
import { denseFixture } from '../../__fixtures__/dense-trace-area';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import { traceImageToColoredPaths } from '../../core/trace/trace-to-paths';
import { traceScalePlan } from '../../core/trace/trace-upscale-policy';
import { resolveTraceSourceOptions } from '../../core/trace/trace-alpha';
import { cropRawImageData } from '../../core/trace/trace-boundary';
import { mergeLightBurnTraceSettings } from './trace-options';

describe('faint detection preserves existing alpha scale policy', () => {
  it.each([
    ['Line Art', 'downscale'],
    ['Smooth', 'native'],
  ])('%s retains its existing alpha grid across a hidden Faint selection', (name, kind) => {
    const image = denseFixture();
    const preset = TRACE_PRESETS[name]!;
    const alpha = mergeLightBurnTraceSettings(preset, {
      traceTransparency: true,
      detectionMode: 'preset',
    });
    const faint = mergeLightBurnTraceSettings(preset, {
      traceTransparency: true,
      detectionMode: 'faint-lines',
    });
    const expected = traceScalePlan(image, alpha);
    expect(expected.kind).toBe(kind);
    expect(traceScalePlan(image, faint)).toEqual(expected);
  });

  it('preserves the complete dense colored alpha output and all twelve small targets', async () => {
    const image = denseFixture('independent');
    const preset = TRACE_PRESETS['Line Art']!;
    const settings = { traceTransparency: true, despeckleMinPixels: 20, ignoreLessThanPixels: 20 };
    const alpha = mergeLightBurnTraceSettings(preset, { ...settings, detectionMode: 'preset' });
    const faint = mergeLightBurnTraceSettings(preset, {
      ...settings,
      detectionMode: 'faint-lines',
    });
    const expected = await traceImageToColoredPaths(image, alpha);
    const targets = expected
      .flatMap((path) => path.polylines)
      .filter((line) => line.points.every((point) => point.x > 950));
    expect(targets).toHaveLength(12);
    expect(await traceImageToColoredPaths(image, faint)).toEqual(expected);
  }, 30_000);

  it('retains deliberate Manual and Sketch scaling overrides', () => {
    const image = denseFixture();
    const preset = TRACE_PRESETS['Line Art']!;
    const manual = mergeLightBurnTraceSettings(preset, {
      traceTransparency: true,
      detectionMode: 'manual',
    });
    const sketch = mergeLightBurnTraceSettings(preset, {
      traceTransparency: true,
      detectionMode: 'sketch',
    });
    expect(traceScalePlan(image, manual)).toEqual({ kind: 'native' });
    expect(traceScalePlan(image, sketch).kind).toBe('downscale');
  });

  it('carries full-source alpha ownership through an opaque cropped region', async () => {
    const full = denseFixture();
    for (let offset = 3; offset < full.data.length; offset += 4) full.data[offset] = 255;
    full.data[3] = 0;
    const image = cropRawImageData(full, {
      x: 16,
      y: 0,
      width: full.width - 16,
      height: full.height,
    });
    const preset = TRACE_PRESETS['Line Art']!;
    const alpha = mergeLightBurnTraceSettings(preset, {
      traceTransparency: true,
      detectionMode: 'preset',
    });
    const faint = mergeLightBurnTraceSettings(preset, {
      traceTransparency: true,
      detectionMode: 'faint-lines',
    });
    const sourceAlpha = resolveTraceSourceOptions(full, alpha);
    const sourceFaint = resolveTraceSourceOptions(full, faint);
    // Without the full-source verdict, this opaque region legitimately uses
    // dense luminance fallback. Inheriting alpha instead selects the full tile.
    expect(traceScalePlan(image, faint).kind).toBe('downscale');
    expect(traceScalePlan(image, sourceAlpha)).toEqual({ kind: 'native' });
    expect(traceScalePlan(image, sourceFaint)).toEqual({ kind: 'native' });
    const expected = await traceImageToColoredPaths(image, sourceAlpha);
    expect(expected.reduce((sum, path) => sum + path.polylines.length, 0)).toBe(1);
    expect(await traceImageToColoredPaths(image, sourceFaint)).toEqual(expected);
  }, 30_000);
});
