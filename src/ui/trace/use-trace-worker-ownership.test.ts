import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as Client from './use-trace-worker-client';
import type { RawImageData, TraceOptions } from '../../core/trace';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';
const inline = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../../core/trace', () => ({
  traceImageToColoredPaths: inline,
  boundsFromColoredPaths: () => ({ minX: 0, minY: 0, maxX: 0, maxY: 0 }),
}));
const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  options: TraceOptions = {
    numberOfColors: 2,
    pathOmit: 0,
    lineTolerance: 1,
    quadraticTolerance: 1,
    blurRadius: 0,
    blurDelta: 0,
    lineFilter: false,
    fixedPalette: ['#ffffff', '#000000'],
  };
class OwnedWorker {
  static all: OwnedWorker[] = [];
  static failConstruction = false;
  static failPost = false;
  onmessage: ((event: MessageEvent<TraceWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  posts: TraceWorkerRequest[] = [];
  transferredBuffers: ArrayBuffer[] = [];
  terminated = 0;
  constructor() {
    if (OwnedWorker.failConstruction) throw Error('construction failure');
    OwnedWorker.all.push(this);
  }
  postMessage(request: TraceWorkerRequest, transfer: Transferable[]) {
    if (OwnedWorker.failPost) throw Error('send failure');
    expect(transfer).toEqual([request.image.data.buffer]);
    const buffer = transfer[0];
    if (!(buffer instanceof ArrayBuffer)) throw Error('Expected an ArrayBuffer transfer');
    this.transferredBuffers.push(buffer);
    this.posts.push(structuredClone(request, { transfer: [buffer] }));
  }
  terminate() {
    this.terminated++;
  }
  emit(kind: 'started' | 'ok' | 'error', id = this.posts.at(-1)!.id) {
    const request = this.posts.find((r) => r.id === id) ?? this.posts.at(-1)!;
    const data: TraceWorkerResponse =
      kind === 'ok'
        ? { id, kind, paths: [], bounds, width: request.image.width, height: request.image.height }
        : kind === 'error'
          ? { id, kind, message: 'request failure' }
          : { id, kind };
    this.onmessage?.({ data } as MessageEvent<TraceWorkerResponse>);
  }
}
let client: typeof Client;
const large = (width = 401): RawImageData => ({
  width,
  height: 400,
  data: new Uint8ClampedArray(width * 400 * 4),
});
const small = (): RawImageData => ({
  width: 4,
  height: 4,
  data: Uint8ClampedArray.from({ length: 64 }, (_, i) => i * 3),
});
const latest = () => OwnedWorker.all.at(-1)!;
function observe(promise: Promise<Client.TraceResult>) {
  const state: { settlements: number; result?: Client.TraceResult; error?: unknown } = {
    settlements: 0,
  };
  const done = promise.then(
    (result) => {
      state.result = result;
      state.settlements++;
    },
    (error: unknown) => {
      state.error = error;
      state.settlements++;
    },
  );
  return { state, done };
}
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  OwnedWorker.all = [];
  OwnedWorker.failConstruction = false;
  OwnedWorker.failPost = false;
  inline.mockClear();
  vi.stubGlobal('Worker', OwnedWorker);
  client = await import('./use-trace-worker-client');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('retires three unfinished owners, settles each once without fallback/retry, and reuses completed work', async () => {
  const input = small(),
    bytes = Array.from(input.data),
    runs = [observe(client.traceImageWithFallback(input, options))];
  for (let i = 0; i < 3; i++) {
    runs.push(observe(client.traceImageWithFallback(input, options)));
    await flush();
  }
  expect(OwnedWorker.all).toHaveLength(4);
  expect(OwnedWorker.all.map((w) => w.terminated)).toEqual([1, 1, 1, 0]);
  for (const run of runs.slice(0, -1)) {
    await run.done;
    expect(run.state.settlements).toBe(1);
    expect(client.isTraceRequestSuperseded(run.state.error)).toBe(true);
  }
  latest().emit('ok');
  await flush(); // empty aggressive result has its legitimate relaxed retry
  expect(latest().posts).toHaveLength(2);
  latest().emit('ok');
  await runs[3]!.done;
  expect(runs[3]!.state.settlements).toBe(1);
  expect(inline).not.toHaveBeenCalled();
  expect(OwnedWorker.all.map((w) => w.posts.length)).toEqual([1, 1, 1, 2]);
  expect(Array.from(input.data)).toEqual(bytes);
  expect(input.data.byteLength).toBe(64);
  expect(
    OwnedWorker.all.flatMap((w) => w.transferredBuffers).every((b) => b.byteLength === 0),
  ).toBe(true);
  expect(
    OwnedWorker.all
      .flatMap((w) => w.posts)
      .every((r) => JSON.stringify(Array.from(r.image.data)) === JSON.stringify(bytes)),
  ).toBe(true);
  const next = client.traceImage(input, options);
  latest().emit('ok');
  await next;
  expect(OwnedWorker.all).toHaveLength(4);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60000);
  expect(latest().terminated).toBe(0);
});

for (const kind of ['started', 'ok', 'error'] as const)
  it(`ignores an old instance's captured ${kind} callback even with the current request id`, async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const first = observe(client.traceImage(large(401), options)),
      old = latest(),
      callback = old.onmessage!;
    const second = observe(client.traceImage(large(402), options));
    const third = observe(client.traceImage(large(403), options)),
      current = latest(),
      id = current.posts.at(-1)!.id;
    const data: TraceWorkerResponse =
      kind === 'ok'
        ? { kind, id, paths: [], bounds, width: 999, height: 999 }
        : kind === 'error'
          ? { kind, id, message: 'obsolete error' }
          : { kind, id };
    const armed = timers.mock.calls.length;
    callback({ data } as MessageEvent<TraceWorkerResponse>);
    await flush();
    expect(timers.mock.calls).toHaveLength(armed);
    expect(third.state.settlements).toBe(0);
    expect(current.terminated).toBe(0);
    current.emit('ok');
    await Promise.all([first.done, second.done, third.done]);
    expect(third.state.result?.width).toBe(403);
    expect(third.state.settlements).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

it('ignores a retired owner runtime error while its replacement is pending and after completion', async () => {
  const first = observe(client.traceImage(large(), options)),
    crash = latest().onerror!;
  const second = observe(client.traceImage(large(402), options)),
    secondCrash = latest().onerror!;
  const third = observe(client.traceImage(large(403), options)),
    current = latest();
  crash();
  secondCrash();
  await flush();
  expect(third.state.settlements).toBe(0);
  expect(current.terminated).toBe(0);
  current.emit('ok');
  await Promise.all([first.done, second.done, third.done]);
  crash();
  secondCrash();
  expect(current.terminated).toBe(0);
  const fourth = client.traceImage(large(404), options);
  expect(latest()).toBe(current);
  current.emit('ok');
  expect((await fourth).width).toBe(404);
});

it('disposes old watchdogs and rejects their captured callbacks across three request owners', async () => {
  const timers = vi.spyOn(globalThis, 'setTimeout');
  const first = observe(client.traceImage(large(), options));
  latest().emit('started');
  const oldTimers = timers.mock.calls.map((c) => c[0]);
  await vi.advanceTimersByTimeAsync(1000);
  const second = observe(client.traceImage(large(402), options));
  latest().emit('started');
  oldTimers.push(...timers.mock.calls.slice(oldTimers.length).map((c) => c[0]));
  await vi.advanceTimersByTimeAsync(1000);
  const third = observe(client.traceImage(large(403), options)),
    current = latest();
  for (const callback of oldTimers) {
    if (typeof callback === 'function') callback();
  }
  await flush();
  expect(third.state.settlements).toBe(0);
  expect(current.terminated).toBe(0);
  expect(vi.getTimerCount()).toBe(1);
  current.emit('ok');
  await Promise.all([first.done, second.done, third.done]);
  expect(vi.getTimerCount()).toBe(0);
  for (const callback of oldTimers) {
    if (typeof callback === 'function') callback();
  }
  expect(current.terminated).toBe(0);
});

it('keeps both no-ack and started-then-hung requests bounded on their own worker', async () => {
  const first = observe(client.traceImage(large(), options));
  await vi.advanceTimersByTimeAsync(30000);
  await first.done;
  expect(String(first.state.error)).toContain('timed out');
  expect(latest().terminated).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  const second = observe(client.traceImage(large(402), options)),
    current = latest();
  await vi.advanceTimersByTimeAsync(25000);
  current.emit('started');
  await vi.advanceTimersByTimeAsync(29999);
  expect(second.state.settlements).toBe(0);
  expect(current.terminated).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  await second.done;
  expect(String(second.state.error)).toContain('timed out');
  expect(current.terminated).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

for (const pixels of [159600, 160000, 160400])
  it(`retains the existing construction-failure boundary at ${pixels} pixels and recovers`, async () => {
    OwnedWorker.failConstruction = true;
    const input = large(pixels / 400),
      run = observe(client.traceImage(input, options));
    await run.done;
    if (pixels <= 160000) {
      expect(run.state.result?.width).toBe(input.width);
      expect(inline).toHaveBeenCalledTimes(1);
    } else {
      expect(String(run.state.error)).toContain('unavailable for this large image');
      expect(inline).not.toHaveBeenCalled();
    }
    OwnedWorker.failConstruction = false;
    const recovered = client.traceImage(input, options);
    latest().emit('ok');
    expect((await recovered).width).toBe(input.width);
    expect(OwnedWorker.all).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

for (const smallInput of [false, true])
  it(`keeps request-level errors recoverable with bounded fallback=${smallInput}`, async () => {
    const input = smallInput ? small() : large(),
      run = observe(client.traceImage(input, options)),
      owner = latest();
    owner.emit('error');
    await run.done;
    if (smallInput) {
      expect(run.state.result).toBeDefined();
      expect(inline).toHaveBeenCalledTimes(1);
    } else {
      expect(String(run.state.error)).toContain('request failure');
      expect(inline).not.toHaveBeenCalled();
    }
    expect(owner.terminated).toBe(0);
    const recovered = client.traceImage(input, options);
    expect(latest()).toBe(owner);
    owner.emit('ok');
    await recovered;
    expect(vi.getTimerCount()).toBe(0);
  });

it('contains a synchronous send failure during replacement and accepts a later healthy owner', async () => {
  const first = observe(client.traceImage(large(), options)),
    oldError = latest().onerror!;
  OwnedWorker.failPost = true;
  const second = observe(client.traceImage(large(402), options));
  await Promise.all([first.done, second.done]);
  expect(client.isTraceRequestSuperseded(first.state.error)).toBe(true);
  expect(String(second.state.error)).toContain('postMessage failed: send failure');
  expect(OwnedWorker.all.map((w) => w.terminated)).toEqual([1, 1]);
  expect(vi.getTimerCount()).toBe(0);
  OwnedWorker.failPost = false;
  const third = observe(client.traceImage(large(403), options)),
    current = latest();
  oldError();
  await flush();
  expect(third.state.settlements).toBe(0);
  current.emit('ok');
  await third.done;
  expect(third.state.result?.width).toBe(403);
});

it('retains small runtime-failure fallback and fresh-worker recovery without stale death', async () => {
  const first = observe(client.traceImage(small(), options)),
    crash = latest().onerror!;
  crash();
  await first.done;
  expect(first.state.result).toBeDefined();
  expect(inline).toHaveBeenCalledTimes(1);
  expect(latest().terminated).toBe(1);
  const second = observe(client.traceImage(large(), options)),
    current = latest();
  crash();
  await flush();
  expect(second.state.settlements).toBe(0);
  current.emit('ok');
  await second.done;
  expect(second.state.result?.width).toBe(401);
  expect(vi.getTimerCount()).toBe(0);
});
