import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./use-trace-worker-client', () => ({
  traceImageWithFallback: vi.fn(),
}));

// Spy on the histogram so a test can prove the UI thread never computes the
// whole image's Otsu cut in Enhance mode (ADR-410).
vi.mock('../../core/trace/preprocess', async (importOriginal) => {
  const actual = await importOriginal<typeof Preprocess>();
  return { ...actual, otsuThreshold: vi.fn(actual.otsuThreshold) };
});

import type { ColoredPath } from '../../core/scene';
import type * as Preprocess from '../../core/trace/preprocess';
import type { RawImageData, TraceBoundary, TraceOptions } from '../../core/trace';
import { otsuThreshold } from '../../core/trace/preprocess';
import { resolveFrozenTraceSourceOptions } from '../../core/trace/trace-source-decisions';
import { traceImageWithBoundaryMode } from './region-enhance-trace';
import { traceImageWithFallback } from './use-trace-worker-client';

const options: TraceOptions = {
  numberOfColors: 2,
  pathOmit: 8,
  lineTolerance: 1,
  quadraticTolerance: 1,
  blurRadius: 0,
  blurDelta: 0,
  lineFilter: true,
};

// 20x20 opaque black raster — big enough that a boxed region and its 2x
// supersample stay well under the upscale pixel budget.
const image: RawImageData = {
  width: 20,
  height: 20,
  data: new Uint8ClampedArray(20 * 20 * 4).fill(0),
};

// The user boxes the middle of the image. The interior (shrunk 1px each side)
// is [6,6]..[14,14], so a polyline at 9..11 sits inside it and one at 0..2 (a
// corner) sits outside — the survival/replacement split the merge relies on.
const region: TraceBoundary = { x: 5, y: 5, width: 10, height: 10 };

function polyline(points: ReadonlyArray<readonly [number, number]>) {
  return { closed: false, points: points.map(([x, y]) => ({ x, y })) };
}

afterEach(() => {
  vi.mocked(traceImageWithFallback).mockReset();
  vi.mocked(otsuThreshold).mockClear();
});

describe('traceImageWithBoundaryMode — crop mode', () => {
  it('delegates to the crop path (single trace of the cropped region), unchanged', async () => {
    const cropPaths: ColoredPath[] = [
      {
        color: '#000000',
        polylines: [
          polyline([
            [0, 0],
            [2, 2],
          ]),
        ],
      },
    ];
    vi.mocked(traceImageWithFallback).mockResolvedValue({
      paths: cropPaths,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      width: 10,
      height: 10,
    });

    const result = await traceImageWithBoundaryMode(image, options, region, 'crop');

    // Crop traces exactly once, on the cropped region (10x10), and the geometry
    // is offset back to the region origin — no full-image trace, no enhance.
    expect(traceImageWithFallback).toHaveBeenCalledTimes(1);
    expect(traceImageWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ width: 10, height: 10 }),
      options,
      undefined,
      undefined,
    );
    expect(result.paths).toEqual([
      {
        color: '#000000',
        polylines: [
          polyline([
            [5, 5],
            [7, 7],
          ]),
        ],
      },
    ]);
    // Geometry was offset into the original working image, so the result must
    // not leak the cropped request's 10x10 grid.
    expect(result).toMatchObject({ width: 20, height: 20 });
  });

  it('delegates the full-image trace when there is no boundary', async () => {
    const fullPaths: ColoredPath[] = [
      {
        color: '#000000',
        polylines: [
          polyline([
            [0, 0],
            [19, 19],
          ]),
        ],
      },
    ];
    vi.mocked(traceImageWithFallback).mockResolvedValue({
      paths: fullPaths,
      bounds: { minX: 0, minY: 0, maxX: 19, maxY: 19 },
      width: 20,
      height: 20,
    });

    const result = await traceImageWithBoundaryMode(image, options, null, 'enhance');

    expect(traceImageWithFallback).toHaveBeenCalledTimes(1);
    expect(traceImageWithFallback).toHaveBeenCalledWith(image, options, undefined, undefined);
    expect(result.paths).toEqual(fullPaths);
    expect(result).toMatchObject({ width: 20, height: 20 });
  });
});

describe('traceImageWithBoundaryMode — enhance mode', () => {
  it('patches the full trace: region-contained polyline replaced, outside one survives', async () => {
    const fullTrace: ColoredPath[] = [
      {
        color: '#000000',
        polylines: [
          // Fully inside the interior [6,6]..[14,14] → dropped and replaced.
          polyline([
            [9, 9],
            [11, 11],
          ]),
          // A corner, outside the interior → must survive untouched.
          polyline([
            [0, 0],
            [2, 2],
          ]),
        ],
      },
    ];
    // The region re-trace runs on the SUPERSAMPLED crop. The box plus its
    // context ring (ADR-410) covers the whole 20x20 image, and
    // computeRegionUpscaleFactor returns 2, so the injected tracer sees a 40x40
    // buffer and its output is downscaled by 2 then offset by the padded
    // origin (0,0): (18,18)->(9,9); (22,22)->(11,11) — inside the interior.
    const enhancedCrop: ColoredPath[] = [
      {
        color: '#000000',
        polylines: [
          polyline([
            [18, 18],
            [22, 22],
          ]),
        ],
      },
    ];

    vi.mocked(traceImageWithFallback)
      .mockResolvedValueOnce({
        paths: fullTrace,
        bounds: { minX: 0, minY: 0, maxX: 19, maxY: 19 },
        width: 20,
        height: 20,
      })
      .mockResolvedValueOnce({
        paths: enhancedCrop,
        bounds: { minX: 8, minY: 8, maxX: 12, maxY: 12 },
        width: 20,
        height: 20,
      });

    const owner = new AbortController();
    const result = await traceImageWithBoundaryMode(
      image,
      options,
      region,
      'enhance',
      owner.signal,
    );

    // Two traces: the full image, then the supersampled crop.
    expect(traceImageWithFallback).toHaveBeenCalledTimes(2);
    expect(traceImageWithFallback).toHaveBeenNthCalledWith(
      1,
      image,
      options,
      owner.signal,
      undefined,
      { freezeSourceDecisions: true },
    );
    expect(traceImageWithFallback).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ width: 40, height: 40 }),
      expect.objectContaining({
        ...options,
        autoUpscaleSmallSources: false,
        pixelScale: 2,
        supersampleContour: false,
        upscaleSmallSmoothSources: false,
      }),
      owner.signal,
      undefined,
    );

    const polylines = result.paths.flatMap((p) => p.polylines);
    expect(result).toMatchObject({ width: 20, height: 20 });
    // The outside corner survived.
    expect(polylines).toContainEqual(
      polyline([
        [0, 0],
        [2, 2],
      ]),
    );
    // The re-traced replacement is present (downscaled + offset into the region).
    expect(polylines).toContainEqual(
      polyline([
        [9, 9],
        [11, 11],
      ]),
    );
    // The original region-contained polyline was dropped — no polyline retains
    // its exact interior geometry except the re-traced replacement (which
    // happens to share endpoints here by construction; assert the count is
    // right: one survivor + one replacement = two, not three).
    expect(polylines).toHaveLength(2);
  });
});

describe('traceImageWithBoundaryMode � frozen decisions stay off the UI thread (ADR-410)', () => {
  const otsuOptions: TraceOptions = { ...options, useOtsuThreshold: true };
  const blank = (): RawImageData => ({
    width: 20,
    height: 20,
    data: new Uint8ClampedArray(20 * 20 * 4).fill(255),
  });
  const result = (sourceOptions?: TraceOptions) => ({
    paths: [] as ColoredPath[],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    width: 20,
    height: 20,
    ...(sourceOptions === undefined ? {} : { sourceOptions }),
  });

  it('asks the full pass to resolve them and hands its answer to the crop re-trace', async () => {
    const source = blank();
    // A cut the UI thread could not have derived from a blank image.
    const resolved = { ...otsuOptions, sourceOtsuThreshold: 77 };
    vi.mocked(traceImageWithFallback)
      .mockResolvedValueOnce(result(resolved))
      .mockResolvedValueOnce(result());

    await traceImageWithBoundaryMode(source, otsuOptions, region, 'enhance');

    expect(traceImageWithFallback).toHaveBeenNthCalledWith(
      1,
      source,
      otsuOptions,
      undefined,
      undefined,
      { freezeSourceDecisions: true },
    );
    expect(traceImageWithFallback).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ width: 40, height: 40 }),
      expect.objectContaining({ sourceOtsuThreshold: 77, pixelScale: 2 }),
      undefined,
      undefined,
    );
    expect(otsuThreshold).not.toHaveBeenCalled();
    // Control: the spy does see the UI-thread resolver when it runs.
    resolveFrozenTraceSourceOptions(source, otsuOptions);
    expect(otsuThreshold).toHaveBeenCalled();
  });

  it('reuses them while the box moves, and resolves again when a setting changes', async () => {
    const source = blank();
    const resolved = { ...otsuOptions, sourceOtsuThreshold: 77 };
    vi.mocked(traceImageWithFallback).mockImplementation(async (_img, opts, _s, _p, flags) =>
      result(
        flags?.freezeSourceDecisions === true
          ? { ...otsuOptions, ...opts, sourceOtsuThreshold: 77 }
          : undefined,
      ),
    );

    await traceImageWithBoundaryMode(source, otsuOptions, region, 'enhance');
    await traceImageWithBoundaryMode(
      source,
      otsuOptions,
      { ...region, x: region.x + 1 },
      'enhance',
    );
    const changed = { ...otsuOptions, pathOmit: 4 };
    await traceImageWithBoundaryMode(source, changed, region, 'enhance');

    const fullPassOptions = vi
      .mocked(traceImageWithFallback)
      .mock.calls.filter((call) => call[4]?.freezeSourceDecisions === true)
      .map((call) => call[1]);
    expect(fullPassOptions).toEqual([otsuOptions, resolved, changed]);
  });
});
