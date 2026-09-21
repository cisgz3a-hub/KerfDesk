import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RawImageData } from '../../core/trace';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';

const workers: ControlledWorker[] = [];
class ControlledWorker {
  onmessage: ((event: MessageEvent<TraceWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly requests: TraceWorkerRequest[] = [];
  readonly terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
  postMessage(request: TraceWorkerRequest): void {
    this.requests.push(request);
  }
  emit(kind: 'started' | 'progress' | 'ok'): void {
    const request = this.requests.at(-1);
    if (request === undefined) throw Error('No worker request');
    const response: TraceWorkerResponse =
      kind === 'ok'
        ? {
            id: request.id,
            kind,
            paths: [],
            bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
            width: request.image.width,
            height: request.image.height,
          }
        : { id: request.id, kind };
    this.onmessage?.({ data: response } as MessageEvent<TraceWorkerResponse>);
  }
}

function image(width = 401): RawImageData {
  return { width, height: 400, data: new Uint8ClampedArray(width * 400 * 4) };
}

async function client() {
  vi.resetModules();
  vi.useFakeTimers();
  workers.length = 0;
  vi.stubGlobal('Worker', ControlledWorker);
  return import('./use-trace-worker-client');
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('trace cancellation belongs to one request', () => {
  it.each(['posted', 'started', 'progress'] as const)(
    'retires cancelled %s work without waiting for silence or retrying',
    async (phase) => {
      const api = await client();
      const owner = new AbortController();
      const result = api
        .traceImage(image(), TRACE_PRESETS.Sharp!, owner.signal)
        .catch((e: unknown) => e);
      if (phase !== 'posted') workers[0]?.emit(phase);
      owner.abort();
      expect(api.isTraceRequestSuperseded(await result)).toBe(true);
      expect(workers[0]?.terminate).toHaveBeenCalledOnce();
      expect(workers).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not run a small cancelled request through its inline fallback', async () => {
    const api = await client();
    const owner = new AbortController();
    const result = api
      .traceImage(image(2), TRACE_PRESETS.Sharp!, owner.signal)
      .catch((e: unknown) => e);
    owner.abort();
    expect(api.isTraceRequestSuperseded(await result)).toBe(true);
    expect(workers).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an already cancelled owner cannot create a worker or supersede unrelated work', async () => {
    const api = await client();
    const current = api.traceImage(image(), TRACE_PRESETS.Sharp!);
    const cancelled = new AbortController();
    cancelled.abort();
    const rejected = await api
      .traceImage(image(402), TRACE_PRESETS.Sharp!, cancelled.signal)
      .catch((e: unknown) => e);
    expect(api.isTraceRequestSuperseded(rejected)).toBe(true);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminate).not.toHaveBeenCalled();
    workers[0]?.emit('ok');
    await expect(current).resolves.toMatchObject({ width: 401 });
  });

  it('closing a superseded preview does not terminate its replacement', async () => {
    const api = await client();
    const owner = new AbortController();
    const obsolete = api
      .traceImage(image(), TRACE_PRESETS.Sharp!, owner.signal)
      .catch((e: unknown) => e);
    const replacement = api.traceImage(image(402), TRACE_PRESETS.Sharp!);
    owner.abort();
    expect(api.isTraceRequestSuperseded(await obsolete)).toBe(true);
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    expect(workers[1]?.terminate).not.toHaveBeenCalled();
    workers[1]?.emit('ok');
    await expect(replacement).resolves.toMatchObject({ width: 402 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(workers[1]?.terminate).not.toHaveBeenCalled();
  });

  it('closing a completed preview preserves its result and a reused worker', async () => {
    const api = await client();
    const owner = new AbortController();
    const completed = api.traceImage(image(), TRACE_PRESETS.Sharp!, owner.signal);
    workers[0]?.emit('ok');
    const prepared = await completed;
    const replacement = api.traceImage(image(402), TRACE_PRESETS.Sharp!);
    owner.abort();
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminate).not.toHaveBeenCalled();
    workers[0]?.emit('ok');
    await expect(replacement).resolves.toMatchObject({ width: 402 });
    expect(prepared.width).toBe(401);
  });
});
