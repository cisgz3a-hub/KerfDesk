import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./use-trace-worker-client', () => ({
  traceImageWithFallback: vi.fn(),
}));

import type { RawImageData, TraceOptions } from '../../core/trace';
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
const traceResult = { paths: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };

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
    expect(setState).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ready' }));
  });

  it('does not set error when a failing trace is no longer current', async () => {
    vi.mocked(traceImageWithFallback).mockRejectedValue(new Error('boom'));
    const setState = vi.fn();
    await runTrace({ img, options, isCurrent: () => false, setState });
    expect(setState).not.toHaveBeenCalled();
  });
});
