import { describe, expect, it } from 'vitest';
import { denseFixture, rect } from '../../__fixtures__/dense-trace-area';
import { components } from '../../__fixtures__/auto-detail-trace';
import { resampleBuffer } from '../image-resample';
import { polylineToCurveSubpath, type ColoredPath } from '../scene';
import { enhanceRegionPaths } from './region-enhance';
import { TRACE_PRESETS } from './trace-presets';
import { prepareTraceForContour, type TraceOptions } from './trace-image';
import { traceImageToColoredPaths } from './trace-to-paths';
import { traceScalePlan } from './trace-upscale-policy';
import { cropRawImageData } from './trace-boundary';

const base: TraceOptions = { ...TRACE_PRESETS['Line Art']!, traceTransparency: true };
const nativeFlags = {
  supersampleContour: false,
  autoUpscaleSmallSources: false,
  upscaleSmallSmoothSources: false,
  pixelScale: 1,
};
const targets = (paths: ColoredPath[]) =>
  paths.flatMap((p) => p.polylines).filter((p) => p.points.every((q) => q.x > 950));

describe('source-grid area controls during dense downsampling', () => {
  it.each([1499, 1500, 1501])(
    'keeps the dense resolution boundary at %s by 1000 pixels',
    async (width) => {
      const image = cropRawImageData(denseFixture(), { x: 0, y: 0, width, height: 1000 });
      const options = { ...base, despeckleMinPixels: 20, ignoreLessThanPixels: 20 },
        plan = traceScalePlan(image, options);
      expect(plan.kind).toBe(width > 1500 ? 'downscale' : 'native');
      if (plan.kind === 'native')
        expect(targets(await traceImageToColoredPaths(image, options))).toHaveLength(12);
      else if (plan.kind === 'downscale') {
        const working = resampleBuffer(image, plan.width, plan.height),
          areaRatio = (working.width / image.width) * (working.height / image.height);
        const reference = await traceImageToColoredPaths(working, {
          ...options,
          ...nativeFlags,
          despeckleMinPixels: 20 * areaRatio,
          ignoreLessThanPixels: 20 * areaRatio,
        });
        expect(await traceImageToColoredPaths(image, options)).toEqual(
          restoreSourceGrid(reference, image.width / plan.width, image.height / plan.height),
        );
      }
    },
    30000,
  );
  it.each(['original', 'independent'] as const)(
    'retains the twelve %s targets with the historic 20/20 bundle',
    async (kind) => {
      const image = denseFixture(kind),
        options = { ...base, despeckleMinPixels: 20, ignoreLessThanPixels: 20 };
      expect(targets(await traceImageToColoredPaths(image, options))).toHaveLength(12);
    },
    30000,
  );

  it.each(['remove', 'ignore'] as const)(
    'converts the independent %s control and preserves fractional equality',
    async (control) => {
      const image = denseFixture(),
        plan = traceScalePlan(image, base);
      expect(plan.kind).toBe('downscale');
      if (plan.kind !== 'downscale') return;
      const working = resampleBuffer(image, plan.width, plan.height),
        ratio = (working.width / image.width) * (working.height / image.height);
      const mask = prepareTraceForContour(working, {
        ...base,
        ...nativeFlags,
        despeckleMinPixels: 0,
        ignoreLessThanPixels: 0,
      }).prepared;
      const x = Math.floor((950 * working.width) / image.width),
        y = Math.floor((40 * working.height) / image.height);
      const areas = components(
        mask,
        [x, y, working.width - x, Math.ceil((50 * working.height) / image.height)],
        true,
      ).areas;
      expect(areas).toEqual([16, 16, 16, 16, 16, 16, 16, 16, 20, 20, 20, 20]);
      for (const minWorking of [0, 15.999, 16, 16.001, 20, 20.001]) {
        const threshold = minWorking / ratio;
        const options = {
          ...base,
          despeckleMinPixels: control === 'remove' ? threshold : 0,
          ignoreLessThanPixels: control === 'ignore' ? threshold : 0,
        };
        expect(targets(await traceImageToColoredPaths(image, options))).toHaveLength(
          areas.filter((a) => a >= minWorking).length,
        );
      }
    },
    60000,
  );

  it('retains legitimate enclosed holes when only Ignore Less Than is enabled', async () => {
    const image = denseFixture();
    for (let n = 0; n < 12; n++) {
      rect(image, 1000 + n * 40, 120, 20, 20);
      rect(image, 1007 + n * 40, 127, 5, 5, [255, 255, 255, 0]);
    }
    const options = { ...base, despeckleMinPixels: 0, ignoreLessThanPixels: 20 };
    const paths = await traceImageToColoredPaths(image, options);
    // Twelve original target loops plus twelve frame contours and their twelve holes.
    expect(targets(paths)).toHaveLength(36);
  }, 30000);

  it('matches the identical working raster with the actual X/Y area conversion applied once', async () => {
    const image = denseFixture('independent'),
      options = Object.freeze({ ...base, despeckleMinPixels: 20, ignoreLessThanPixels: 20 });
    const plan = traceScalePlan(image, options);
    expect(plan.kind).toBe('downscale');
    if (plan.kind !== 'downscale') return;
    const working = resampleBuffer(image, plan.width, plan.height),
      ratio = (plan.width / image.width) * (plan.height / image.height);
    expect(ratio).not.toBe((plan.width / image.width) ** 2);
    const reference = await traceImageToColoredPaths(working, {
      ...options,
      ...nativeFlags,
      despeckleMinPixels: 20 * ratio,
      ignoreLessThanPixels: 20 * ratio,
    });
    const before = image.data.slice();
    expect(await traceImageToColoredPaths(image, options)).toEqual(
      restoreSourceGrid(reference, image.width / plan.width, image.height / plan.height),
    );
    expect(image.data.length).toBe(before.length);
    expect(image.data.every((value, index) => value === before[index])).toBe(true);
    expect(options.ignoreLessThanPixels).toBe(20);
  }, 30000);

  it('keeps zero controls and the existing pinhole classifier unchanged', async () => {
    const image = denseFixture(),
      options = {
        ...base,
        despeckleMinPixels: 0,
        ignoreLessThanPixels: 0,
        fillPinholeCracks: true,
      };
    rect(image, 1000, 140, 20, 20);
    rect(image, 1009, 146, 1, 8, [255, 255, 255, 0]);
    const plan = traceScalePlan(image, options);
    expect(plan.kind).toBe('downscale');
    if (plan.kind !== 'downscale') return;
    const reference = await traceImageToColoredPaths(
      resampleBuffer(image, plan.width, plan.height),
      { ...options, ...nativeFlags },
    );
    expect(await traceImageToColoredPaths(image, options)).toEqual(
      restoreSourceGrid(reference, image.width / plan.width, image.height / plan.height),
    );
  }, 30000);

  it('keeps an enhanced region on its existing 2x area units without double conversion', async () => {
    const image = denseFixture(),
      options = { ...base, despeckleMinPixels: 20, ignoreLessThanPixels: 20 };
    const full = await traceImageToColoredPaths(image, options),
      calls: TraceOptions[] = [];
    const enhanced = await enhanceRegionPaths({
      image,
      options,
      region: { x: 950, y: 40, width: 550, height: 50 },
      fullTracePaths: full,
      trace: async (im, op) => {
        calls.push(op);
        return traceImageToColoredPaths(im, op);
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      pixelScale: 2,
      despeckleMinPixels: 20,
      ignoreLessThanPixels: 20,
      supersampleContour: false,
    });
    expect(targets(full)).toHaveLength(12);
    expect(targets(enhanced)).toHaveLength(12);
  }, 30000);
});

function restoreSourceGrid(paths: ColoredPath[], scaleX: number, scaleY: number): ColoredPath[] {
  return paths.map((path) => {
    const polylines = path.polylines.map((line) => ({
      closed: line.closed,
      points: line.points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY })),
    }));
    return { color: path.color, polylines, curves: polylines.map(polylineToCurveSubpath) };
  });
}
