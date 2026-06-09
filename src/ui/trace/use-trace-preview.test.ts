import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./use-trace-worker-client', () => ({
  traceImageWithFallback: vi.fn(),
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
});
