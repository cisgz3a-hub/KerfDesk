import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualBoxGenerationWorker as FakeWorker } from '../../__fixtures__/box/manual-box-generation-worker';
import type { BoxSpec, GenerateBoxResult } from '../../core/box';
import type * as boxGenerationClient from './box-generation-worker-client';
import type { BoxGenerationWorkerResponse } from './box-generation-worker-protocol';

const SPEC: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
  dividersXCount: 0,
  dividersYCount: 0,
};

const GENERATED: GenerateBoxResult = { kind: 'generated', panels: [] };

type BoxGenerationClient = typeof boxGenerationClient;
type BoxGenerationTask = NonNullable<ReturnType<BoxGenerationClient['startBoxGeneration']>>;

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => vi.unstubAllGlobals());

describe('startBoxGeneration', () => {
  it('returns null when Worker support is unavailable', async () => {
    vi.unstubAllGlobals();
    const client = await loadClient();
    expect(client.startBoxGeneration(SPEC)).toBeNull();
  });

  it('returns null when the module worker cannot be constructed', async () => {
    function BrokenWorker(): never {
      throw new Error('worker chunk missing');
    }
    vi.stubGlobal('Worker', BrokenWorker);
    const client = await loadClient();
    expect(client.startBoxGeneration(SPEC)).toBeNull();
  });

  it('posts one typed request and resolves the matching result without retiring the worker', async () => {
    const client = await loadClient();
    const task = requiredTask(client);
    const worker = currentWorker();
    expect(worker.posted).toEqual([{ kind: 'generate', id: task.id, spec: SPEC }]);

    worker.respond(resultFor(task.id));

    await expect(task.promise).resolves.toEqual({ result: GENERATED, metrics: null });
    expect(worker.isTerminated).toBe(false);
  });

  // Callers cannot be trusted to supply unique ids: the box dialog is
  // conditionally mounted, so its own counter restarts on every reopen while
  // this module and its warm worker survive.
  it('mints its own monotonic ids so a reused caller counter cannot collide', async () => {
    const client = await loadClient();
    const first = requiredTask(client);
    first.cancel();
    const second = requiredTask(client);
    const third = requiredTask(client);
    const settled = recordSettlements({ second: second.promise, third: third.promise });

    expect(second.id).toBeGreaterThan(first.id);
    expect(third.id).toBeGreaterThan(second.id);

    // The cancelled generation still finishes inside the worker; its late
    // response must not settle either request minted after it.
    currentWorker().respond(resultFor(first.id));
    await expect(first.promise).rejects.toBeInstanceOf(client.BoxGenerationCancelledError);
    expect(settled).toEqual([]);
  });

  it('reuses one warm worker across requests instead of reloading the module graph', async () => {
    const client = await loadClient();
    const first = requiredTask(client);
    currentWorker().respond(resultFor(first.id));
    await first.promise;

    const second = requiredTask(client);
    currentWorker().respond(resultFor(second.id));
    await expect(second.promise).resolves.toEqual({ result: GENERATED, metrics: null });

    expect(FakeWorker.instances).toHaveLength(1);
    expect(currentWorker().posted.map((request) => request.id)).toEqual([first.id, second.id]);
  });

  it('drops a cancelled id and keeps the worker serving the next request', async () => {
    const client = await loadClient();
    const cancelled = requiredTask(client);
    const worker = currentWorker();
    cancelled.cancel();
    cancelled.cancel();
    worker.respond(resultFor(cancelled.id));

    await expect(cancelled.promise).rejects.toBeInstanceOf(client.BoxGenerationCancelledError);
    expect(worker.isTerminated).toBe(false);

    const next = requiredTask(client);
    worker.respond(resultFor(next.id));
    await expect(next.promise).resolves.toEqual({ result: GENERATED, metrics: null });
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('ignores responses whose id is no longer tracked', async () => {
    const client = await loadClient();
    const task = requiredTask(client);
    const untracked = task.id + 1;
    const worker = currentWorker();
    worker.respond(resultFor(untracked));
    worker.respond({ kind: 'fatal', id: untracked, message: 'superseded geometry failed' });
    worker.respond(resultFor(task.id));

    await expect(task.promise).resolves.toEqual({ result: GENERATED, metrics: null });
    expect(worker.isTerminated).toBe(false);
  });

  it('rejects a fatal response for its own id without retiring the worker', async () => {
    const client = await loadClient();
    const task = requiredTask(client);
    currentWorker().respond({ kind: 'fatal', id: task.id, message: 'geometry failed' });

    await expect(task.promise).rejects.toThrow('geometry failed');
    expect(currentWorker().isTerminated).toBe(false);
  });

  it('retires the worker on runtime and deserialization failures and respawns next request', async () => {
    const client = await loadClient();
    const runtime = requiredTask(client);
    const runtimeWorker = currentWorker();
    runtimeWorker.onerror?.();
    await expect(runtime.promise).rejects.toThrow('worker errored');
    expect(runtimeWorker.isTerminated).toBe(true);

    const message = requiredTask(client);
    expect(FakeWorker.instances).toHaveLength(2);
    currentWorker().onmessageerror?.();
    await expect(message.promise).rejects.toThrow('could not be read');
    expect(currentWorker().isTerminated).toBe(true);
  });

  it('rejects a synchronous postMessage failure and retires the worker', async () => {
    class ThrowingWorker extends FakeWorker {
      override postMessage(): void {
        throw new Error('clone failed');
      }
    }
    vi.stubGlobal('Worker', ThrowingWorker);
    const client = await loadClient();
    const task = requiredTask(client);

    await expect(task.promise).rejects.toThrow('clone failed');
    expect(currentWorker().isTerminated).toBe(true);
  });
});

// The client holds one warm worker in module scope, so each test loads its own
// copy of the module rather than inheriting the previous test's worker.
async function loadClient(): Promise<BoxGenerationClient> {
  vi.resetModules();
  return import('./box-generation-worker-client');
}

function resultFor(id: number): BoxGenerationWorkerResponse {
  return { kind: 'result', id, result: GENERATED, metrics: null };
}

function requiredTask(client: BoxGenerationClient): BoxGenerationTask {
  const task = client.startBoxGeneration(SPEC);
  if (task === null) throw new Error('task missing');
  return task;
}

// Names every task promise that settles, so a request wrongly answered by a
// stale response shows up by name instead of as a silent pass.
function recordSettlements(tasks: Record<string, Promise<unknown>>): ReadonlyArray<string> {
  const settled: string[] = [];
  for (const [name, promise] of Object.entries(tasks)) {
    void promise.then(
      () => settled.push(name),
      () => settled.push(name),
    );
  }
  return settled;
}

function currentWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error('worker missing');
  return worker;
}
