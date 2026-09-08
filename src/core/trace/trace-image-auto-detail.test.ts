import { describe, expect, it } from 'vitest';
import {
  accepted,
  blank,
  components,
  illuminated,
  rect,
  score,
} from '../../__fixtures__/auto-detail-trace';
import { shouldUseSketchTrace } from './auto-sketch-trace';
import { prepareTraceForContour, type TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

const automatic = TRACE_PRESETS['Line Art']!;
const rawOptions: TraceOptions = { ...automatic, despeckleMinPixels: 0, fillPinholeCracks: false };

describe('automatic detail recovery retains brightness-selected ink', () => {
  it.each(['original', 'independent'] as const)(
    'keeps the unchanged %s solid ROI across remote colour promotion',
    async (kind) => {
      const counts = kind === 'original' ? [32, 33, 34, 64] : [40, 41, 42];
      for (const count of counts) {
        const { image, roi } = accepted(kind, count);
        const { prepared } = prepareTraceForContour(image, automatic);
        expect(components(prepared, roi, true).pixels).toBe(roi[2]! * roi[3]!);
        expect(
          components(prepared, [roi[0]! - 2, roi[1]! - 2, roi[2]! + 4, roi[3]! + 4], false)
            .enclosed,
        ).toBe(0);
        const paths = await traceImageToColoredPaths(image, automatic);
        expect(
          paths
            .flatMap((p) => p.polylines)
            .filter((p) => p.points.every((q) => q.x < 60 && q.y < 65)),
        ).toHaveLength(1);
      }
    },
  );

  it('retains the square when a distant patch changes chroma but not foreground intent', () => {
    for (const red of [209, 210, 211]) {
      const { image, roi } = accepted('original', 33, [red, 198, 198, 255]);
      expect(components(prepareTraceForContour(image, automatic).prepared, roi, true).pixels).toBe(
        1600,
      );
    }
  });

  it.each(['pale', 'uneven', 'low-contrast'] as const)(
    'recovers labelled %s strokes without adding background ink',
    (kind) => {
      const { image, foreground, weak } = illuminated(kind);
      const prepared = prepareTraceForContour(image, automatic).prepared;
      const manual = prepareTraceForContour(image, {
        ...automatic,
        autoSketchTrace: false,
      }).prepared;
      let weakRecovered = 0,
        manualWeak = 0;
      for (let i = 0; i < weak.length; i++) {
        if (weak[i] && prepared.data[4 * i]! < 128) weakRecovered++;
        if (weak[i] && manual.data[4 * i]! < 128) manualWeak++;
      }
      expect(weakRecovered).toBeGreaterThanOrEqual(0.95 * weak.reduce((a, b) => a + b, 0));
      expect(manualWeak).toBe(0);
      expect(score(prepared, foreground)).toMatchObject({ fn: 0, fp: 0 });
    },
  );

  it('leaves binary artwork identical to its manual brightness result', () => {
    const { image } = illuminated('binary');
    expect(shouldUseSketchTrace(image, automatic)).toBe(false);
    expect(prepareTraceForContour(image, automatic).prepared).toEqual(
      prepareTraceForContour(image, { ...automatic, autoSketchTrace: false }).prepared,
    );
  });

  it.each([1, 1.25, 1.5, 2])(
    'uses compatible mask and field on a %sx source neighbourhood',
    (scale) => {
      const image = blank(128 * scale, 96 * scale);
      rect(image, 8 * scale, 8 * scale, 32 * scale, 32 * scale);
      rect(image, 64 * scale, 20 * scale, 4 * scale, 40 * scale, [208, 200, 184, 255]);
      const { prepared, crackField } = prepareTraceForContour(image, {
        ...rawOptions,
        pixelScale: scale,
      });
      expect(crackField).not.toBeNull();
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          expect(crackField!.lumaAt(x, y) <= crackField!.thresholdAt(x, y)).toBe(
            prepared.data[4 * (y * image.width + x)]! < 128,
          );
        }
      expect(
        components(prepared, [8 * scale, 8 * scale, 32 * scale, 32 * scale], true).pixels,
      ).toBe(1024 * scale * scale);
    },
  );

  it('keeps the inclusive solid threshold and strict local equality in the field', () => {
    // The whole 5x8 window has mean (162 + 6*171 + 172)/8 = 170.
    // Row one is exactly mean - 8 and must remain background.
    // Every pixel has chroma 24, so the 32-pixel automatic trigger is satisfied.
    const image = blank(5, 8);
    rect(image, 0, 0, 5, 1, [169, 161, 145, 255]);
    rect(image, 0, 1, 5, 6, [178, 170, 154, 255]);
    rect(image, 0, 7, 5, 1, [179, 171, 155, 255]);
    const { prepared, crackField } = prepareTraceForContour(image, rawOptions);
    expect(prepared.data[0]).toBe(255);
    expect(crackField!.lumaAt(0, 0)).toBe(162);
    expect(crackField!.thresholdAt(0, 0)).toBeLessThan(162);
    const solid = blank(40, 2);
    rect(solid, 0, 0, 40, 2, [136, 128, 112, 255]);
    const atThreshold = prepareTraceForContour(solid, { ...rawOptions, thresholdLuma: 129 });
    expect(components(atThreshold.prepared, [0, 0, 40, 2], true).pixels).toBe(80);
    expect(atThreshold.crackField!.thresholdAt(0, 0)).toBe(129);
  });

  it('uses midpoint geometry for the two-sided brightness band union', () => {
    const image = blank(40, 1);
    rect(image, 0, 0, 40, 1, [88, 80, 64, 255]);
    const { prepared, crackField } = prepareTraceForContour(image, {
      ...rawOptions,
      cutoffLuma: 40,
      thresholdLuma: 100,
    });
    expect(components(prepared, [0, 0, 40, 1], true).pixels).toBe(40);
    expect(crackField).toBeNull();
  });

  it('preserves alpha precedence, opaque derived regions, and requested options', () => {
    const { image } = accepted('original', 33);
    const requested = Object.freeze({
      ...automatic,
      traceTransparency: true,
      sourceHasTransparency: true,
    });
    const before = image.data.slice();
    const { prepared, crackField } = prepareTraceForContour(image, requested);
    expect(components(prepared, [0, 0, 128, 128], true).pixels).toBe(128 * 128);
    expect(crackField).toBeNull();
    expect(image.data).toEqual(before);
    const opaqueFallback = prepareTraceForContour(image, {
      ...automatic,
      traceTransparency: true,
      sourceHasTransparency: false,
    });
    expect(opaqueFallback.prepared).toEqual(prepareTraceForContour(image, automatic).prepared);
  });
});
