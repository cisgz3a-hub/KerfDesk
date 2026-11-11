import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRACE_PRESETS, type RawImageData } from '../../core/trace';
import { runTraceSteps } from '../../core/trace/trace-steps';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';
import { packedTracePathsTransfer, unpackTracePathsSteps } from './trace-result-transfer';

afterEach(() => vi.unstubAllGlobals());

describe('compact Photo worker result', () => {
  it('posts only the exact polyline representation from the real worker', async () => {
    const image: RawImageData = {
      width: 8,
      height: 8,
      data: Uint8ClampedArray.from({ length: 8 * 8 * 4 }, (_, i) => (i % 4 === 3 ? 255 : 192)),
    };
    const posted: TraceWorkerResponse[] = [];
    const transfers: unknown[][] = [];
    const scope = {
      onmessage: null as ((event: MessageEvent<TraceWorkerRequest>) => void) | null,
      postMessage: (response: TraceWorkerResponse, transfer: unknown[] = []) => {
        posted.push(response);
        transfers.push(transfer);
      },
    };
    vi.stubGlobal('self', scope);
    await import('./trace-worker');
    scope.onmessage?.({
      data: { id: 4, image, options: TRACE_PRESETS['Photo shading']! },
    } as MessageEvent<TraceWorkerRequest>);
    await vi.waitFor(() => expect(posted.some((response) => response.kind === 'ok')).toBe(true));
    const index = posted.findIndex((message) => message.kind === 'ok');
    const response = posted[index];
    if (response?.kind !== 'ok' || response.packedPaths === undefined) {
      throw new Error('No packed worker result');
    }
    // The geometry crosses as transferred buffers, not one object per vertex.
    expect(response.paths).toBeUndefined();
    expect(transfers[index]).toEqual(packedTracePathsTransfer(response.packedPaths));
    const paths = runTraceSteps(unpackTracePathsSteps(response.packedPaths));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path.curves === undefined)).toBe(true);
    expect(paths[0]?.polylines.every((line) => line.closed)).toBe(true);
  });
});
