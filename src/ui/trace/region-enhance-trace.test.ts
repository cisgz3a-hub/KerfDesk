import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./use-trace-worker-client', () => ({
  traceImageWithFallback: vi.fn(),
}));

import type { ColoredPath } from '../../core/scene';
import type { RawImageData, TraceBoundary, TraceOptions } from '../../core/trace';
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
    });

    const result = await traceImageWithBoundaryMode(image, options, region, 'crop');

    // Crop traces exactly once, on the cropped region (10x10), and the geometry
    // is offset back to the region origin — no full-image trace, no enhance.
    expect(traceImageWithFallback).toHaveBeenCalledTimes(1);
    expect(traceImageWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ width: 10, height: 10 }),
      options,
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
    });

    const result = await traceImageWithBoundaryMode(image, options, null, 'enhance');

    expect(traceImageWithFallback).toHaveBeenCalledTimes(1);
    expect(traceImageWithFallback).toHaveBeenCalledWith(image, options);
    expect(result.paths).toEqual(fullPaths);
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
    // The region re-trace runs on the SUPERSAMPLED crop. computeRegionUpscaleFactor
    // returns 2 for this small crop, so the injected tracer sees a 20x20 buffer
    // and its output is downscaled by 2 then offset by the region origin (5,5):
    // (8,8)->(4,4)->(9,9); (12,12)->(6,6)->(11,11) — landing inside the interior.
    const enhancedCrop: ColoredPath[] = [
      {
        color: '#000000',
        polylines: [
          polyline([
            [8, 8],
            [12, 12],
          ]),
        ],
      },
    ];

    vi.mocked(traceImageWithFallback)
      .mockResolvedValueOnce({ paths: fullTrace, bounds: { minX: 0, minY: 0, maxX: 19, maxY: 19 } })
      .mockResolvedValueOnce({
        paths: enhancedCrop,
        bounds: { minX: 8, minY: 8, maxX: 12, maxY: 12 },
      });

    const result = await traceImageWithBoundaryMode(image, options, region, 'enhance');

    // Two traces: the full image, then the supersampled crop.
    expect(traceImageWithFallback).toHaveBeenCalledTimes(2);
    expect(traceImageWithFallback).toHaveBeenNthCalledWith(1, image, options);
    expect(traceImageWithFallback).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ width: 20, height: 20 }),
      expect.objectContaining({
        ...options,
        autoUpscaleSmallSources: false,
        pixelScale: 2,
        supersampleContour: false,
        upscaleSmallSmoothSources: false,
      }),
    );

    const polylines = result.paths.flatMap((p) => p.polylines);
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
