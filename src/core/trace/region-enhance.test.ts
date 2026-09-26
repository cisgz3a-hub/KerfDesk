import { describe, expect, it, vi } from 'vitest';
import { polylineToCurveSubpath, type ColoredPath } from '../scene';
import {
  computeRegionUpscaleFactor,
  enhanceRegionPaths,
  replacePathsInRegion,
} from './region-enhance';
import type { RawImageData } from './trace-image';
import type { TraceOptions } from './trace-image';
import { DEFAULT_TRACE_OPTIONS } from './trace-image';

function blankImage(width: number, height: number): RawImageData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function square(x0: number, y0: number, x1: number, y1: number, closed = true) {
  return {
    closed,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  };
}

describe('computeRegionUpscaleFactor', () => {
  it('returns 2x for a typical detail crop', () => {
    expect(computeRegionUpscaleFactor(blankImage(100, 80), DEFAULT_TRACE_OPTIONS)).toBe(2);
  });

  it('returns 1x when 2x would exceed the upscale pixel budget', () => {
    // 1501*2 * 1000*2 = 6.004M > the contour backend's 6M cap.
    expect(computeRegionUpscaleFactor(blankImage(1501, 1000), DEFAULT_TRACE_OPTIONS)).toBe(1);
  });
});

describe('replacePathsInRegion', () => {
  const interior = { x: 10, y: 10, width: 40, height: 40 };

  it('drops contained polylines, keeps crossing and outside ones, merges by colour', () => {
    const existing: ColoredPath[] = [
      {
        color: '#000000',
        polylines: [
          square(20, 20, 30, 30), // fully inside → replaced
          square(5, 5, 15, 15), // crosses the region border → must survive
          square(60, 60, 70, 70), // outside → must survive
        ],
      },
    ];
    const replacement: ColoredPath[] = [{ color: '#000000', polylines: [square(22, 22, 28, 28)] }];
    const out = replacePathsInRegion(existing, interior, replacement);
    expect(out).toHaveLength(1); // same colour folds into one layer
    const polylines = out[0]?.polylines ?? [];
    expect(polylines).toHaveLength(3);
    expect(polylines).toContainEqual(square(5, 5, 15, 15));
    expect(polylines).toContainEqual(square(60, 60, 70, 70));
    expect(polylines).toContainEqual(square(22, 22, 28, 28));
    expect(polylines).not.toContainEqual(square(20, 20, 30, 30));
  });

  it('appends replacement colours that have no existing layer', () => {
    const existing: ColoredPath[] = [{ color: '#000000', polylines: [square(60, 60, 70, 70)] }];
    const replacement: ColoredPath[] = [{ color: '#ff0000', polylines: [square(20, 20, 30, 30)] }];
    const out = replacePathsInRegion(existing, interior, replacement);
    expect(out.map((p) => p.color)).toEqual(['#000000', '#ff0000']);
  });

  it('drops a colour layer whose every polyline was replaced away', () => {
    const existing: ColoredPath[] = [{ color: '#ff0000', polylines: [square(20, 20, 30, 30)] }];
    const out = replacePathsInRegion(existing, interior, []);
    expect(out).toHaveLength(0);
  });
});

describe('replacePathsInRegion keeps canonical data and pairs border shapes (ADR-410)', () => {
  const interior = { x: 10, y: 10, width: 40, height: 40 };

  it('keeps curves and operationIds of survivors and returns untouched paths as-is', () => {
    const crossing = square(5, 5, 15, 15);
    const inside = square(20, 20, 30, 30);
    const edited: ColoredPath = {
      color: '#000000',
      operationIds: ['op-1'],
      fillRule: 'evenodd',
      polylines: [crossing, inside],
      curves: [polylineToCurveSubpath(crossing), polylineToCurveSubpath(inside)],
    };
    const untouched: ColoredPath = {
      color: '#ff0000',
      operationIds: ['op-2'],
      polylines: [square(60, 60, 70, 70)],
      curves: [polylineToCurveSubpath(square(60, 60, 70, 70))],
    };
    const added = square(22, 22, 28, 28);
    const out = replacePathsInRegion([edited, untouched], interior, [
      { color: '#000000', polylines: [added] },
    ]);
    expect(out[1]).toBe(untouched);
    expect(out[0]).toEqual({
      color: '#000000',
      operationIds: ['op-1'],
      fillRule: 'evenodd',
      polylines: [crossing, added],
      curves: [edited.curves?.[0], polylineToCurveSubpath(added)],
    });
    expect(out[0]?.curves?.[0]).toBe(edited.curves?.[0]);
  });

  it('carries a replacement curve with its polyline through the filter', () => {
    const kept = square(22, 22, 28, 28);
    const dropped = square(0, 20, 12, 30);
    const keptCurve = polylineToCurveSubpath(kept);
    const out = replacePathsInRegion([], interior, [
      {
        color: '#000000',
        polylines: [dropped, kept],
        curves: [polylineToCurveSubpath(dropped), keptCurve],
      },
    ]);
    expect(out).toEqual([{ color: '#000000', polylines: [kept], curves: [keptCurve] }]);
  });

  it('follows the original for a shape grazing the interior border', () => {
    // Original just inside the interior; its re-trace pokes 0.3 px out.
    const lost = replacePathsInRegion(
      [{ color: '#000000', polylines: [square(10.2, 20, 16, 26)] }],
      interior,
      [{ color: '#000000', polylines: [square(9.7, 20.1, 16.1, 26)] }],
    );
    expect(lost[0]?.polylines).toEqual([square(9.7, 20.1, 16.1, 26)]);
    // Original just outside (kept); its re-trace lands inside: not doubled.
    const doubled = replacePathsInRegion(
      [{ color: '#000000', polylines: [square(9.8, 20, 16, 26)] }],
      interior,
      [{ color: '#000000', polylines: [square(10.3, 20, 16, 26)] }],
    );
    expect(doubled[0]?.polylines).toEqual([square(9.8, 20, 16, 26)]);
    // A new shape near the border with no original counterpart follows containment.
    const fresh = replacePathsInRegion([], interior, [
      { color: '#000000', polylines: [square(10.3, 20, 16, 26), square(9.5, 30, 12, 34)] },
    ]);
    expect(fresh[0]?.polylines).toEqual([square(10.3, 20, 16, 26)]);
  });
});

describe('enhanceRegionPaths', () => {
  const options: TraceOptions = { ...DEFAULT_TRACE_OPTIONS };

  it('round-trips crop/upscale coordinates and filters crop-edge fragments', async () => {
    const image = blankImage(100, 100);
    const region = { x: 10, y: 10, width: 40, height: 40 };
    const fullTracePaths: ColoredPath[] = [
      {
        color: '#000000',
        polylines: [
          square(20, 20, 30, 30), // inside → replaced
          square(5, 5, 15, 15), // crossing → kept
          square(60, 60, 70, 70), // outside → kept
        ],
      },
    ];
    // The injected tracer sees the 40x40 box plus a 9 px context ring
    // (source 1..59, ADR-410) upscaled 2x, and answers in UPSCALED CROP
    // coordinates: a genuine interior loop plus a fragment hugging the crop
    // edge (x=0), which a real tracer produces when a larger shape is clipped
    // by the crop.
    const trace = vi.fn((cropped: RawImageData, scaledOptions: TraceOptions) => {
      expect(cropped.width).toBe(116);
      expect(cropped.height).toBe(116);
      expect(scaledOptions).toEqual(
        expect.objectContaining({
          autoUpscaleSmallSources: false,
          pixelScale: 2,
          supersampleContour: false,
          upscaleSmallSmoothSources: false,
        }),
      );
      return Promise.resolve<ColoredPath[]>([
        {
          color: '#000000',
          polylines: [
            square(38, 38, 58, 58), // → source 20..30 after /2 and +1 offset
            square(0, 10, 20, 30), // touches crop edge (source x=1) → filtered out
          ],
        },
      ]);
    });
    const out = await enhanceRegionPaths({ image, region, fullTracePaths, options, trace });
    expect(trace).toHaveBeenCalledTimes(1);
    const polylines = out.flatMap((p) => p.polylines);
    expect(polylines).toContainEqual(square(5, 5, 15, 15));
    expect(polylines).toContainEqual(square(60, 60, 70, 70));
    expect(polylines).toContainEqual(square(20, 20, 30, 30)); // the re-traced loop
    expect(polylines).toHaveLength(3); // edge fragment filtered, original inside replaced
  });

  it('returns the input unchanged for a degenerate region without tracing', async () => {
    const image = blankImage(100, 100);
    const fullTracePaths: ColoredPath[] = [
      { color: '#000000', polylines: [square(20, 20, 30, 30)] },
    ];
    const trace = vi.fn(() => Promise.resolve<ColoredPath[]>([]));
    const out = await enhanceRegionPaths({
      image,
      region: { x: 10, y: 10, width: 0, height: 0 },
      fullTracePaths,
      options,
      trace,
    });
    expect(trace).not.toHaveBeenCalled();
    expect(out).toEqual(fullTracePaths);
  });
});
