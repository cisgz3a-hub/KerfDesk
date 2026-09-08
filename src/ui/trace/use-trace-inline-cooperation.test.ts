import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import type { RawImageData } from '../../core/trace';
import type * as TraceCore from '../../core/trace';

type Steps<T> = Generator<void, T, void>;
type Runner = <T>(steps: Steps<T>) => T | Promise<T>;
const control = vi.hoisted(() => ({
  trace: vi.fn(),
  time: 0,
  progress: 0,
  events: [] as string[],
}));
vi.mock('../../core/trace', async (original) => ({
  ...(await original<typeof TraceCore>()),
  traceImageToColoredPaths: control.trace,
}));
const paths: ColoredPath[] = [
  {
    color: '#000000',
    polylines: [
      {
        closed: false,
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      },
    ],
  },
];
const options = {
  numberOfColors: 2,
  pathOmit: 0,
  lineTolerance: 1,
  quadraticTolerance: 1,
  blurRadius: 0,
  blurDelta: 0,
  lineFilter: false,
};
const image = (): RawImageData => ({
  width: 32,
  height: 32,
  data: new Uint8ClampedArray(4096).fill(127),
});
class TestWorker {
  static all: TestWorker[] = [];
  static constructFailures = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  posts: Array<{ id: number }> = [];
  retired = false;
  constructor() {
    if (TestWorker.constructFailures > 0) {
      TestWorker.constructFailures--;
      throw Error('construction');
    }
    TestWorker.all.push(this);
  }
  postMessage(request: { id: number }) {
    this.posts.push(request);
  }
  terminate() {
    this.retired = true;
  }
  ok() {
    this.onmessage?.({
      data: {
        kind: 'ok',
        id: this.posts.at(-1)!.id,
        paths,
        bounds: { minX: 1, minY: 2, maxX: 3, maxY: 4 },
        width: 32,
        height: 32,
      },
    } as MessageEvent);
  }
}
function* work(): Steps<ColoredPath[]> {
  for (let i = 0; i < 100; i++) {
    control.progress++;
    control.time++;
    yield;
  }
  control.events.push('finished');
  return paths;
}
function keep<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  TestWorker.all = [];
  TestWorker.constructFailures = 0;
  control.time = 0;
  control.progress = 0;
  control.events = [];
  control.trace.mockReset();
  vi.spyOn(performance, 'now').mockImplementation(() => control.time);
  vi.stubGlobal('Worker', TestWorker);
  control.trace.mockImplementation(
    async (_image: RawImageData, _options: unknown, run?: Runner) => {
      if (run) return run(work());
      const steps = work();
      let next = steps.next();
      while (!next.done) next = steps.next();
      return next.value;
    },
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('gives input a task after expensive grid preparation before starting the first engine slice', async () => {
  vi.stubGlobal('Worker', undefined);
  const { traceImage } = await import('./use-trace-worker-client');
  control.trace.mockImplementation(async (_image: RawImageData, _options: unknown, run: Runner) => {
    control.time += 80;
    return run(work());
  });
  setTimeout(() => control.events.push('input'), 0);
  const result = keep(traceImage(image(), options));
  expect(control.progress).toBe(0);
  await vi.runAllTimersAsync();
  await expect(result).resolves.toMatchObject({ paths });
  expect(control.events).toEqual(['input', 'finished']);
  expect(vi.getTimerCount()).toBe(0);
});

it('recovers once from a transient constructor failure and reuses the healthy completed worker', async () => {
  TestWorker.constructFailures = 1;
  const { traceImage } = await import('./use-trace-worker-client');
  const first = keep(traceImage(image(), options));
  expect(TestWorker.all).toHaveLength(1);
  expect(control.trace).not.toHaveBeenCalled();
  TestWorker.all[0]!.ok();
  await expect(first).resolves.toMatchObject({ paths });
  const second = keep(traceImage(image(), options));
  TestWorker.all[0]!.ok();
  await second;
  expect(TestWorker.all).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('recovers a small runtime failure with one fresh worker before using inline computation', async () => {
  const { traceImage } = await import('./use-trace-worker-client');
  const result = keep(traceImage(image(), options));
  TestWorker.all[0]!.onerror!();
  await Promise.resolve();
  await Promise.resolve();
  expect(TestWorker.all).toHaveLength(2);
  expect(TestWorker.all[0]!.retired).toBe(true);
  expect(control.trace).not.toHaveBeenCalled();
  TestWorker.all[1]!.ok();
  await result;
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds repeated runtime recovery and then computes cooperatively with source bytes intact', async () => {
  const { traceImage } = await import('./use-trace-worker-client');
  const source = image(),
    before = [...source.data],
    result = keep(traceImage(source, options));
  TestWorker.all[0]!.onerror!();
  await Promise.resolve();
  await Promise.resolve();
  expect(TestWorker.all).toHaveLength(2);
  TestWorker.all[1]!.onerror!();
  await Promise.resolve();
  await Promise.resolve();
  expect(control.progress).toBeGreaterThan(0);
  expect(control.progress).toBeLessThan(100);
  await vi.runAllTimersAsync();
  await expect(result).resolves.toMatchObject({ paths });
  expect(TestWorker.all).toHaveLength(2);
  expect(source.data).toEqual(new Uint8ClampedArray(before));
  expect(control.trace).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('allows a browser task between real computation chunks when Worker is unavailable', async () => {
  vi.stubGlobal('Worker', undefined);
  const { traceImage } = await import('./use-trace-worker-client');
  const result = keep(traceImage(image(), options));
  expect(control.progress).toBeGreaterThan(0);
  expect(control.progress).toBeLessThan(100);
  setTimeout(() => control.events.push('input'), 0);
  await vi.runAllTimersAsync();
  await result;
  expect(control.events).toEqual(['input', 'finished']);
  expect(control.progress).toBe(100);
  expect(vi.getTimerCount()).toBe(0);
});

it('supersedes three cooperative owners once and never launches an obsolete aggressive retry', async () => {
  vi.stubGlobal('Worker', undefined);
  const { traceImageWithFallback, TraceRequestSupersededError } =
    await import('./use-trace-worker-client');
  const settled = [0, 0, 0],
    inputs = [image(), image(), image(), image()];
  const obsolete = inputs.slice(0, 3).map((source, i) =>
    keep(
      traceImageWithFallback(source, { ...options, despeckleMinPixels: 12 }).catch(
        (error: unknown) => {
          settled[i] = (settled[i] ?? 0) + 1;
          throw error;
        },
      ),
    ),
  );
  const latest = keep(traceImageWithFallback(inputs[3]!, options));
  await vi.runAllTimersAsync();
  await latest;
  for (const promise of obsolete)
    await expect(promise).rejects.toBeInstanceOf(TraceRequestSupersededError);
  expect(settled).toEqual([1, 1, 1]);
  expect(control.trace).toHaveBeenCalledTimes(4);
  expect(control.events).toEqual(['finished']);
  expect(vi.getTimerCount()).toBe(0);
  expect(inputs.every((source) => source.data.every((byte) => byte === 127))).toBe(true);
});

it('lets a recovered native worker replace active cooperative work without an old result', async () => {
  vi.stubGlobal('Worker', undefined);
  const { traceImage, TraceRequestSupersededError } = await import('./use-trace-worker-client');
  const old = keep(traceImage(image(), options));
  vi.stubGlobal('Worker', TestWorker);
  const current = keep(traceImage(image(), options));
  TestWorker.all[0]!.ok();
  await current;
  await vi.runAllTimersAsync();
  await expect(old).rejects.toBeInstanceOf(TraceRequestSupersededError);
  expect(TestWorker.all[0]!.retired).toBe(false);
  expect(control.events).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it('propagates a current cooperative failure without restarting it or leaking its timer', async () => {
  vi.stubGlobal('Worker', undefined);
  control.trace.mockImplementation(
    async (_image: RawImageData, _options: unknown, run?: Runner) => {
      function* failing(): Steps<ColoredPath[]> {
        for (let i = 0; i < 40; i++) {
          control.time++;
          yield;
        }
        throw Error('current computation failed');
      }
      if (!run) throw Error('missing cooperative runner');
      return run(failing());
    },
  );
  const { traceImage } = await import('./use-trace-worker-client');
  const result = keep(traceImage(image(), options));
  await vi.runAllTimersAsync();
  await expect(result).rejects.toThrow('current computation failed');
  expect(control.trace).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
