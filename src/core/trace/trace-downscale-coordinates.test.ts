import { describe, expect, it } from 'vitest';
import { denseFixture } from '../../__fixtures__/dense-trace-area';
import { resampleBuffer } from '../image-resample';
import type { CurveSubpath, Vec2 } from '../scene';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';
import { traceScalePlan } from './trace-upscale-policy';

describe('restoring contours from a rounded working grid', () => {
  it.each(['original', 'independent'] as const)(
    'preserves the fractional position on both axes of the %s source',
    async (kind) => {
      const image = denseFixture(kind);
      const options = {
        ...TRACE_PRESETS['Line Art']!,
        traceTransparency: true,
        despeckleMinPixels: 0,
        ignoreLessThanPixels: 0,
      };
      const plan = traceScalePlan(image, options);
      expect(plan.kind).toBe('downscale');
      if (plan.kind !== 'downscale') return;
      const working = resampleBuffer(image, plan.width, plan.height);
      expect(image.width / working.width).not.toBe(image.height / working.height);
      const reference = await traceImageToColoredPaths(working, {
        ...options,
        supersampleContour: false,
        autoUpscaleSmallSources: false,
        upscaleSmallSmoothSources: false,
        pixelScale: 1,
      });
      const restored = await traceImageToColoredPaths(image, options);
      const before = reference.flatMap((path) => path.polylines).flatMap((line) => line.points);
      const after = restored.flatMap((path) => path.polylines).flatMap((line) => line.points);
      expect(before.length).toBeGreaterThan(0);
      expect(after).toHaveLength(before.length);
      for (const [index, point] of before.entries()) {
        expect(after[index]!.x / image.width).toBeCloseTo(point.x / working.width, 12);
        expect(after[index]!.y / image.height).toBeCloseTo(point.y / working.height, 12);
      }
      // The fitted curves survive the restore (ADR-440): each control point
      // is the working trace's, mapped by the two axis scales.
      const workingCurves = reference.flatMap((path) => path.curves ?? []);
      const restoredCurves = restored.flatMap((path) => path.curves ?? []);
      expect(restoredCurves).toHaveLength(workingCurves.length);
      const controls = (curve: CurveSubpath): Vec2[] => [
        curve.start,
        ...curve.segments.flatMap((s) =>
          s.kind === 'cubic' ? [s.control1, s.control2, s.to] : [s.to],
        ),
      ];
      for (const [index, curve] of workingCurves.entries()) {
        const mapped = controls(restoredCurves[index]!);
        const original = controls(curve);
        expect(mapped).toHaveLength(original.length);
        for (const [k, point] of original.entries()) {
          expect(mapped[k]!.x / image.width).toBeCloseTo(point.x / working.width, 12);
          expect(mapped[k]!.y / image.height).toBeCloseTo(point.y / working.height, 12);
        }
      }
    },
    30_000,
  );

  it('keeps the fitted cubics of a disc traced on the working grid', async () => {
    const image = denseFixture('original');
    for (let y = 300; y < 700; y += 1) {
      for (let x = 1100; x < 1500; x += 1) {
        if (Math.hypot(x + 0.5 - 1300, y + 0.5 - 500) <= 150) {
          image.data.set([0, 0, 0, 255], 4 * (y * image.width + x));
        }
      }
    }
    const options = { ...TRACE_PRESETS['Line Art']!, traceTransparency: true };
    expect(traceScalePlan(image, options).kind).toBe('downscale');
    const restored = await traceImageToColoredPaths(image, options);
    const disc = restored
      .flatMap((path) => path.curves ?? [])
      .find((curve) => Math.hypot(curve.start.x - 1300, curve.start.y - 500) < 160);
    // The route used to rebuild every curve as straight segments over the
    // restored polyline; the disc now arrives as the fitter's cubics.
    const cubics = disc?.segments.filter((segment) => segment.kind === 'cubic') ?? [];
    expect(cubics.length).toBeGreaterThan(0);
    expect(cubics.length).toBeGreaterThan((disc?.segments.length ?? 0) / 2);
  }, 30_000);
});
