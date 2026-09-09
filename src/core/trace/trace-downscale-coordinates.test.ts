import { describe, expect, it } from 'vitest';
import { denseFixture } from '../../__fixtures__/dense-trace-area';
import { resampleBuffer } from '../image-resample';
import { polylineToCurveSubpath } from '../scene';
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
      for (const path of restored) {
        expect(path.curves).toEqual(path.polylines.map(polylineToCurveSubpath));
      }
    },
    30_000,
  );
});
