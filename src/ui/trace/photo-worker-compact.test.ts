import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRACE_PRESETS, type RawImageData } from '../../core/trace';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';

afterEach(() => vi.unstubAllGlobals());

describe('compact Photo worker result', () => {
  it('posts only the exact polyline representation from the real worker', async () => {
    const image: RawImageData = {
      width: 8,
      height: 8,
      data: Uint8ClampedArray.from({ length: 8 * 8 * 4 }, (_, i) => (i % 4 === 3 ? 255 : 192)),
    };
    const posted: TraceWorkerResponse[] = [];
    const scope = {
      onmessage: null as ((event: MessageEvent<TraceWorkerRequest>) => void) | null,
      postMessage: (response: TraceWorkerResponse) => posted.push(response),
    };
    vi.stubGlobal('self', scope);
    await import('./trace-worker');
    scope.onmessage?.({
      data: { id: 4, image, options: TRACE_PRESETS['Photo shading']! },
    } as MessageEvent<TraceWorkerRequest>);
    await vi.waitFor(() => expect(posted.some((response) => response.kind === 'ok')).toBe(true));
    const response = posted.find((message) => message.kind === 'ok');
    if (response?.kind !== 'ok') throw new Error('No worker result');
    expect(response.paths.length).toBeGreaterThan(0);
    expect(response.paths.every((path) => path.curves === undefined)).toBe(true);
    expect(response.paths[0]?.polylines.every((line) => line.closed)).toBe(true);
  });
});
