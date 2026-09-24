import { afterEach, expect, it, vi } from 'vitest';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';

// Worker protocol tests do not execute the inline backend. A guarded mock also
// prevents cold algorithm transforms from outliving an individual test's timeout.
const { traceInline } = vi.hoisted(() => ({
  traceInline: vi.fn(() => {
    throw new Error('Worker progress must not fall back to inline tracing');
  }),
}));
vi.mock('../../core/trace', () => ({
  traceImageToColoredPaths: traceInline,
  boundsFromColoredPaths: vi.fn(),
}));

const workers: WorkerStub[] = [];
class WorkerStub {
  onmessage: ((event: MessageEvent<TraceWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  requests: TraceWorkerRequest[] = [];
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
  postMessage(request: TraceWorkerRequest) {
    this.requests.push(request);
  }
  send(response: TraceWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<TraceWorkerResponse>);
  }
  finish() {
    const request = this.requests.at(-1)!;
    this.send({
      id: request.id,
      kind: 'ok',
      paths: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      width: request.image.width,
      height: request.image.height,
    });
  }
}
const image = { width: 401, height: 400, data: new Uint8ClampedArray(401 * 400 * 4) };
afterEach(() => {
  vi.unstubAllGlobals();
  expect(traceInline).not.toHaveBeenCalled();
  traceInline.mockClear();
});

it('forwards only owned phase messages, leaving heartbeats out of UI updates', async () => {
  vi.resetModules();
  vi.stubGlobal('Worker', WorkerStub);
  const { traceImage } = await import('./use-trace-worker-client');
  const progress = vi.fn();
  const pending = traceImage(image, TRACE_PRESETS.Sharp!, undefined, progress);
  const worker = workers.at(-1)!;
  const id = worker.requests[0]!.id;
  worker.send({ id, kind: 'started' });
  worker.send({ id, kind: 'progress' });
  expect(progress).not.toHaveBeenCalled();
  worker.send({ id: id + 99, kind: 'progress', phase: 'refining' });
  worker.send({ id, kind: 'progress', phase: 'preparing' });
  worker.send({ id, kind: 'progress', phase: 'tracing' });
  expect(progress.mock.calls).toEqual([['preparing'], ['tracing']]);
  worker.finish();
  await pending;
});

it('ignores phases from a retired worker and from a cancelled current request', async () => {
  vi.resetModules();
  vi.stubGlobal('Worker', WorkerStub);
  const { traceImage } = await import('./use-trace-worker-client');
  const oldProgress = vi.fn(),
    newProgress = vi.fn();
  const first = traceImage(image, TRACE_PRESETS.Sharp!, undefined, oldProgress).catch(
    (error: unknown) => error,
  );
  const old = workers.at(-1)!,
    oldHandler = old.onmessage!;
  const controller = new AbortController();
  const next = traceImage(image, TRACE_PRESETS.Smooth!, controller.signal, newProgress).catch(
    (error: unknown) => error,
  );
  const current = workers.at(-1)!,
    currentHandler = current.onmessage!;
  oldHandler({
    data: { id: old.requests[0]!.id, kind: 'progress', phase: 'refining' },
  } as MessageEvent<TraceWorkerResponse>);
  expect(oldProgress).not.toHaveBeenCalled();
  current.send({ id: current.requests[0]!.id, kind: 'progress', phase: 'tracing' });
  controller.abort();
  currentHandler({
    data: { id: current.requests[0]!.id, kind: 'progress', phase: 'refining' },
  } as MessageEvent<TraceWorkerResponse>);
  expect(newProgress.mock.calls).toEqual([['tracing']]);
  expect(await first).toMatchObject({ name: 'TraceRequestSupersededError' });
  expect(await next).toMatchObject({ name: 'TraceRequestSupersededError' });
});
