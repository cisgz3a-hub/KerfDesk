import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoxSpec, GenerateBoxResult } from '../../core/box';
import { BoxGenerationCancelledError, startBoxGeneration } from './box-generation-worker-client';
import type {
  BoxGenerationWorkerRequest,
  BoxGenerationWorkerResponse,
} from './box-generation-worker-protocol';

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

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<BoxGenerationWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: BoxGenerationWorkerRequest[] = [];
  isTerminated = false;
  postError: Error | null = null;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(request: BoxGenerationWorkerRequest): void {
    if (this.postError !== null) throw this.postError;
    this.posted.push(request);
  }

  terminate(): void {
    this.isTerminated = true;
  }

  respond(response: BoxGenerationWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<BoxGenerationWorkerResponse>);
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => vi.unstubAllGlobals());

describe('startBoxGeneration', () => {
  it('returns null when Worker support is unavailable', () => {
    vi.unstubAllGlobals();
    expect(startBoxGeneration(1, SPEC)).toBeNull();
  });

  it('returns null when the module worker cannot be constructed', () => {
    function BrokenWorker(): never {
      throw new Error('worker chunk missing');
    }
    vi.stubGlobal('Worker', BrokenWorker);
    expect(startBoxGeneration(1, SPEC)).toBeNull();
  });

  it('posts one typed request and resolves the matching result', async () => {
    const task = requiredTask(7);
    const worker = currentWorker();
    expect(worker.posted).toEqual([{ kind: 'generate', id: 7, spec: SPEC }]);

    worker.respond({ kind: 'result', id: 7, result: GENERATED, metrics: null });

    await expect(task.promise).resolves.toEqual({ result: GENERATED, metrics: null });
    expect(worker.isTerminated).toBe(true);
    expect(worker.onmessage).toBeNull();
  });

  it('terminates active work and rejects cancellation without accepting a late result', async () => {
    const task = requiredTask(1);
    const worker = currentWorker();
    const lateHandler = worker.onmessage;

    task.cancel();
    task.cancel();
    lateHandler?.({
      data: { kind: 'result', id: 1, result: GENERATED, metrics: null },
    } as MessageEvent<BoxGenerationWorkerResponse>);

    await expect(task.promise).rejects.toBeInstanceOf(BoxGenerationCancelledError);
    expect(worker.isTerminated).toBe(true);
  });

  it('rejects and retires a mismatched response', async () => {
    const task = requiredTask(2);
    const worker = currentWorker();
    worker.respond({ kind: 'result', id: 3, result: GENERATED, metrics: null });

    await expect(task.promise).rejects.toThrow('mismatched request');
    expect(worker.isTerminated).toBe(true);
  });

  it('rejects worker fatal, runtime error, and message-deserialization failures', async () => {
    const fatal = requiredTask(3);
    currentWorker().respond({ kind: 'fatal', id: 3, message: 'geometry failed' });
    await expect(fatal.promise).rejects.toThrow('geometry failed');

    const runtime = requiredTask(4);
    currentWorker().onerror?.();
    await expect(runtime.promise).rejects.toThrow('worker errored');

    const message = requiredTask(5);
    currentWorker().onmessageerror?.();
    await expect(message.promise).rejects.toThrow('could not be read');
  });

  it('rejects a synchronous postMessage failure and retires the worker', async () => {
    class ThrowingWorker extends FakeWorker {
      override postMessage(): void {
        throw new Error('clone failed');
      }
    }
    vi.stubGlobal('Worker', ThrowingWorker);

    const task = startBoxGeneration(6, SPEC);
    if (task === null) throw new Error('task missing');

    await expect(task.promise).rejects.toThrow('clone failed');
    expect(currentWorker().isTerminated).toBe(true);
  });
});

function requiredTask(id: number): NonNullable<ReturnType<typeof startBoxGeneration>> {
  const task = startBoxGeneration(id, SPEC);
  if (task === null) throw new Error('task missing');
  return task;
}

function currentWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error('worker missing');
  return worker;
}
