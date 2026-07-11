import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./use-trace-worker-client', () => ({
  traceImageWithFallback: vi.fn(),
  isTraceRequestSuperseded: (error: unknown) =>
    error instanceof Error && error.name === 'TraceRequestSupersededError',
}));

import type { ColoredPath } from '../../core/scene';
import type { RawImageData, TraceOptions, TraceBoundary } from '../../core/trace';
import { traceImageWithFallback } from './use-trace-worker-client';
import { runTrace } from './use-trace-preview';

const img: RawImageData = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
const options: TraceOptions = {
  numberOfColors: 2,
  pathOmit: 8,
  lineTolerance: 1,
  quadraticTolerance: 1,
  blurRadius: 0,
  blurDelta: 0,
  lineFilter: true,
};
const tracedPaths: ColoredPath[] = [
  {
    color: '#000000',
    polylines: [
      {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ],
  },
];
const traceResult = { paths: tracedPaths, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };

afterEach(() => {
  vi.mocked(traceImageWithFallback).mockReset();
});

describe('runTrace stale-result guard (P2-A)', () => {
  it('does not set state when the trace is no longer current', async () => {
    vi.mocked(traceImageWithFallback).mockResolvedValue(traceResult);
    const setState = vi.fn();
    await runTrace({ img, options, isCurrent: () => false, setState });
    expect(setState).not.toHaveBeenCalled();
  });

  it('sets ready when the trace is still current', async () => {
    vi.mocked(traceImageWithFallback).mockResolvedValue(traceResult);
    const setState = vi.fn();
    await runTrace({ img, options, isCurrent: () => true, setState });
    expect(setState).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ready', paths: tracedPaths }),
    );
  });

  it('retains the matching request and trace result for commit reuse', async () => {
    vi.mocked(traceImageWithFallback).mockResolvedValue(traceResult);
    const file = new File(['image'], 'logo.png', { type: 'image/png' });
    const request = { file, options, boundary: null, boundaryMode: 'crop' as const };
    const setState = vi.fn();

    await runTrace({ img, options, request, isCurrent: () => true, setState });

    expect(setState).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ready',
        preparedTrace: { request, result: traceResult },
      }),
    );
  });

  it('traces only the bounded pixels and offsets preview geometry back into the source image', async () => {
    const boundary: TraceBoundary = { x: 1, y: 0, width: 1, height: 2 };
    vi.mocked(traceImageWithFallback).mockResolvedValue({
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 1, y: 2 },
              ],
            },
          ],
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 2 },
    });

    const setState = vi.fn();
    await runTrace({ img, options, boundary, isCurrent: () => true, setState });

    expect(traceImageWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1, height: 2 }),
      options,
    );
    expect(setState).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ready',
        width: 2,
        height: 2,
        paths: [
          {
            color: '#000000',
            polylines: [
              {
                closed: false,
                points: [
                  { x: 1, y: 0 },
                  { x: 2, y: 2 },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(setState.mock.calls[0]?.[0].svg).toContain('viewBox="0 0 2 2"');
  });

  it('does not set error when a failing trace is no longer current', async () => {
    vi.mocked(traceImageWithFallback).mockRejectedValue(new Error('boom'));
    const setState = vi.fn();
    await runTrace({ img, options, isCurrent: () => false, setState });
    expect(setState).not.toHaveBeenCalled();
  });

  it('does not show a superseded request as an error while still current', async () => {
    const superseded = new Error('superseded');
    superseded.name = 'TraceRequestSupersededError';
    vi.mocked(traceImageWithFallback).mockRejectedValue(superseded);
    const setState = vi.fn();
    await runTrace({ img, options, isCurrent: () => true, setState });
    expect(setState).not.toHaveBeenCalled();
  });

  it('reaches the enhance path: preview reflects the region-patched full trace', async () => {
    // 20x20 opaque raster so the boxed region + its 2x supersample stay under
    // the upscale budget and the enhance merge runs end-to-end.
    const enhanceImg: RawImageData = {
      width: 20,
      height: 20,
      data: new Uint8ClampedArray(20 * 20 * 4).fill(0),
    };
    const boundary: TraceBoundary = { x: 5, y: 5, width: 10, height: 10 };
    const pl = (pts: ReadonlyArray<readonly [number, number]>) => ({
      closed: false,
      points: pts.map(([x, y]) => ({ x, y })),
    });
    // Full trace: one polyline inside the interior [6,6]..[14,14] (replaced) and
    // one corner outside it (survives).
    vi.mocked(traceImageWithFallback)
      .mockResolvedValueOnce({
        paths: [
          {
            color: '#000000',
            polylines: [
              pl([
                [9, 9],
                [11, 11],
              ]),
              pl([
                [0, 0],
                [2, 2],
              ]),
            ],
          },
        ],
        bounds: { minX: 0, minY: 0, maxX: 19, maxY: 19 },
      })
      // Region re-trace on the 20x20 supersample; downscaled /2 + offset (5,5).
      .mockResolvedValueOnce({
        paths: [
          {
            color: '#000000',
            polylines: [
              pl([
                [6, 6],
                [10, 10],
              ]),
            ],
          },
        ],
        bounds: { minX: 6, minY: 6, maxX: 10, maxY: 10 },
      });

    const setState = vi.fn();
    await runTrace({
      img: enhanceImg,
      options,
      boundary,
      boundaryMode: 'enhance',
      isCurrent: () => true,
      setState,
    });

    const ready = setState.mock.calls[0]?.[0];
    const previewPolylines = ready.paths.flatMap((p: ColoredPath) => p.polylines);
    // Outside corner survived; re-traced replacement present ((8,8)->(4,4)->(8,8),
    // (10,10)->(5,5)->(10,10)) — inside the interior.
    expect(previewPolylines).toContainEqual(
      pl([
        [0, 0],
        [2, 2],
      ]),
    );
    expect(previewPolylines).toContainEqual(
      pl([
        [8, 8],
        [10, 10],
      ]),
    );
    expect(previewPolylines).toHaveLength(2);
  });
});
