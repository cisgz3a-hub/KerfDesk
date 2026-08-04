import { describe, expect, it, vi } from 'vitest';
import { BoundedCompilationWorkerPool } from './bounded-compilation-worker-pool';
import type {
  BoundedCompilationJob,
  BoundedCompilationTask,
  BoundedCompilationWorkerLike,
  BoundedCompilationWorkerRequest,
} from './bounded-compilation-worker-pool-protocol';

type Payload = { readonly value: number };
type Result = string;
type Task = BoundedCompilationTask<Payload>;
type Job = BoundedCompilationJob<Payload, Result>;

class FakeWorker implements BoundedCompilationWorkerLike<Payload> {
  public onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onmessageerror: ((event: unknown) => void) | null = null;
  public readonly posted: Array<BoundedCompilationWorkerRequest<Payload>> = [];
  public terminated = false;
  public throwOnNextPost = false;

  postMessage(message: BoundedCompilationWorkerRequest<Payload>): void {
    if (this.throwOnNextPost) {
      this.throwOnNextPost = false;
      throw new Error('post failed');
    }
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(postIndex: number, result: Result): void {
    const request = this.posted[postIndex];
    if (request === undefined) throw new Error(`no posted request at ${postIndex}`);
    this.onmessage?.({
      data: {
        kind: 'ok',
        submissionId: request.submissionId,
        jobId: request.jobId,
        taskId: request.taskId,
        result,
      },
    });
  }

  replyRaw(data: unknown): void {
    this.onmessage?.({ data });
  }

  runtimeError(): void {
    this.onerror?.(new Error('worker runtime failed'));
  }

  messageError(): void {
    this.onmessageerror?.(new Error('worker response was not cloneable'));
  }
}

class WorkerHarness {
  public readonly workers: FakeWorker[] = [];
  public readonly throwOnCreate = new Set<number>();
  public createCount = 0;

  create = (): FakeWorker => {
    this.createCount += 1;
    if (this.throwOnCreate.has(this.createCount)) throw new Error('worker constructor failed');
    const worker = new FakeWorker();
    this.workers.push(worker);
    return worker;
  };
}

describe('BoundedCompilationWorkerPool', () => {
  it('uses the supplied fallback for zero tasks but a bounded worker for every nonempty job', async () => {
    const harness = new WorkerHarness();
    const pool = createPool(harness, 3);
    const emptyFallback = vi.fn<Job['sequentialFallback']>(async () => []);
    const oneFallback = vi.fn<Job['sequentialFallback']>(async (submitted, context) => {
      context.reportCompleted(1);
      return submitted.map((task) => fallbackResult(task));
    });

    await expect(
      pool.submit({ jobId: 'empty', tasks: [], sequentialFallback: emptyFallback }),
    ).resolves.toEqual([]);
    const one = pool.submit({
      jobId: 'one',
      tasks: tasks('one', 1),
      sequentialFallback: oneFallback,
    });
    expect(harness.workers).toHaveLength(1);
    harness.workers[0]?.reply(0, 'worker:one-0');
    await expect(one).resolves.toEqual(['worker:one-0']);

    expect(emptyFallback).toHaveBeenCalledOnce();
    expect(oneFallback).not.toHaveBeenCalled();
  });

  it('clamps configured concurrency to two through four and dispatches only one task per slot', async () => {
    const lowHarness = new WorkerHarness();
    const lowPool = createPool(lowHarness, 1);
    const low = lowPool.submit(job('low', 6));
    expect(lowPool.concurrency).toBe(2);
    expect(lowHarness.workers).toHaveLength(2);
    expect(lowHarness.workers.map((worker) => worker.posted.length)).toEqual([1, 1]);
    const lowRejected = expect(low).rejects.toThrow('disposed');
    lowPool.dispose();
    await lowRejected;

    const highHarness = new WorkerHarness();
    const highPool = createPool(highHarness, 99);
    const high = highPool.submit(job('high', 6));
    expect(highPool.concurrency).toBe(4);
    expect(highHarness.workers).toHaveLength(4);
    expect(highHarness.workers.map((worker) => worker.posted.length)).toEqual([1, 1, 1, 1]);
    const highRejected = expect(high).rejects.toThrow('disposed');
    highPool.dispose();
    await highRejected;
  });

  it('stores shuffled worker completions in input order and reports honest counts', async () => {
    const harness = new WorkerHarness();
    const pool = createPool(harness, 2);
    const progress: Array<{ completed: number; active: number; queued: number; total: number }> =
      [];
    const pending = pool.submit({
      ...job('ordered', 3),
      onProgress: ({ completed, active, queued, total }) =>
        progress.push({ completed, active, queued, total }),
    });
    const [first, second] = harness.workers;
    if (first === undefined || second === undefined) throw new Error('expected two workers');

    second.reply(0, 'result:one');
    second.reply(1, 'result:two');
    first.reply(0, 'result:zero');

    await expect(pending).resolves.toEqual(['result:zero', 'result:one', 'result:two']);
    expect(progress).toContainEqual({ completed: 0, active: 2, queued: 1, total: 3 });
    expect(progress.at(-1)).toEqual({ completed: 3, active: 0, queued: 0, total: 3 });
  });

  it('round-robins concurrent jobs across the shared slots', async () => {
    const harness = new WorkerHarness();
    const pool = createPool(harness, 2);
    const firstJob = pool.submit(job('A', 3));
    const secondJob = pool.submit(job('B', 2));
    const [first, second] = harness.workers;
    if (first === undefined || second === undefined) throw new Error('expected two workers');

    first.reply(0, 'A0');
    expect(first.posted[1]).toMatchObject({ jobId: 'A', taskId: 'A-2' });
    second.reply(0, 'A1');
    expect(second.posted[1]).toMatchObject({ jobId: 'B', taskId: 'B-0' });
    second.reply(1, 'B0');
    expect(second.posted[2]).toMatchObject({ jobId: 'B', taskId: 'B-1' });
    second.reply(2, 'B1');
    first.reply(1, 'A2');

    await expect(firstJob).resolves.toEqual(['A0', 'A1', 'A2']);
    await expect(secondJob).resolves.toEqual(['B0', 'B1']);
  });

  it('ignores a late duplicate from an earlier submission even when the job id is reused', async () => {
    const harness = new WorkerHarness();
    const pool = createPool(harness, 2);
    const firstRun = pool.submit(job('reuse', 2));
    const [first, second] = harness.workers;
    if (first === undefined || second === undefined) throw new Error('expected two workers');
    const oldRequest = first.posted[0];
    if (oldRequest === undefined) throw new Error('expected an old request');
    first.reply(0, 'old-0');
    second.reply(0, 'old-1');
    await expect(firstRun).resolves.toEqual(['old-0', 'old-1']);

    const fallback = vi.fn<Job['sequentialFallback']>(async (submitted) =>
      submitted.map((task) => fallbackResult(task)),
    );
    const secondRun = pool.submit({ ...job('reuse', 2), sequentialFallback: fallback });
    first.replyRaw({
      kind: 'ok',
      submissionId: oldRequest.submissionId,
      jobId: oldRequest.jobId,
      taskId: oldRequest.taskId,
      result: 'late-old-result',
    });
    first.reply(1, 'new-0');
    second.reply(1, 'new-1');

    await expect(secondRun).resolves.toEqual(['new-0', 'new-1']);
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(['job id', 'task id'] as const)(
    'rejects a mismatched current %s and reruns the complete job',
    async (mismatch) => {
      const harness = new WorkerHarness();
      const fallback = vi.fn<Job['sequentialFallback']>(async (submitted) =>
        submitted.map((task) => fallbackResult(task)),
      );
      const pool = createPool(harness, 2);
      const pending = pool.submit({ ...job('ids', 3), sequentialFallback: fallback });
      const request = harness.workers[0]?.posted[0];
      if (request === undefined) throw new Error('expected a posted request');

      harness.workers[0]?.replyRaw({
        kind: 'ok',
        submissionId: request.submissionId,
        jobId: mismatch === 'job id' ? 'wrong' : request.jobId,
        taskId: mismatch === 'task id' ? 'wrong' : request.taskId,
        result: 'wrong',
      });

      await expect(pending).resolves.toEqual([
        'fallback:ids-0',
        'fallback:ids-1',
        'fallback:ids-2',
      ]);
      expect(fallback).toHaveBeenCalledOnce();
      expect(harness.workers.slice(0, 2).every((worker) => worker.terminated)).toBe(true);
    },
  );

  it('aborts one job, replaces only its slots, and ignores their stale replies', async () => {
    const harness = new WorkerHarness();
    const pool = createPool(harness, 4);
    const controller = new AbortController();
    const aborted = pool.submit({ ...job('abort', 2), signal: controller.signal });
    const survivor = pool.submit(job('survivor', 2));
    const [abortedOne, abortedTwo, survivorOne, survivorTwo] = harness.workers;
    if (
      abortedOne === undefined ||
      abortedTwo === undefined ||
      survivorOne === undefined ||
      survivorTwo === undefined
    ) {
      throw new Error('expected four workers');
    }
    const staleReply = abortedOne.onmessage;
    const abortedRejection = expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await abortedRejection;
    expect(abortedOne.terminated).toBe(true);
    expect(abortedTwo.terminated).toBe(true);
    expect(survivorOne.terminated).toBe(false);
    expect(survivorTwo.terminated).toBe(false);

    const replacement = pool.submit(job('replacement', 2));
    const [replacementOne, replacementTwo] = harness.workers.slice(4);
    if (replacementOne === undefined || replacementTwo === undefined) {
      throw new Error('expected replacement workers');
    }
    staleReply?.({
      data: {
        kind: 'ok',
        submissionId: 999,
        jobId: 'replacement',
        taskId: 'replacement-0',
        result: 'stale',
      },
    });
    replacementOne.reply(0, 'R0');
    replacementTwo.reply(0, 'R1');
    survivorOne.reply(0, 'S0');
    survivorTwo.reply(0, 'S1');

    await expect(replacement).resolves.toEqual(['R0', 'R1']);
    await expect(survivor).resolves.toEqual(['S0', 'S1']);
  });

  it('dispose terminates workers, aborts fallbacks, and rejects every active job', async () => {
    const harness = new WorkerHarness();
    const pool = createPool(harness, 2);
    let releaseFallback: ((results: ReadonlyArray<Result>) => void) | undefined;
    const fallback = vi.fn<Job['sequentialFallback']>(
      (_submitted, context) =>
        new Promise((resolve) => {
          expect(context.signal.aborted).toBe(false);
          releaseFallback = resolve;
        }),
    );
    const sequential = pool.submit({ ...job('sequential', 1), sequentialFallback: fallback });
    harness.workers[0]?.runtimeError();
    await Promise.resolve();
    await Promise.resolve();
    const parallel = pool.submit(job('parallel', 2));
    const parallelRejection = expect(parallel).rejects.toThrow('disposed');
    const sequentialRejection = expect(sequential).rejects.toThrow('disposed');

    pool.dispose();

    await Promise.all([parallelRejection, sequentialRejection]);
    expect(harness.workers.every((worker) => worker.terminated)).toBe(true);
    expect(fallback.mock.calls[0]?.[1].signal.aborted).toBe(true);
    releaseFallback?.(['late']);
    await expect(pool.submit(job('after-dispose', 2))).rejects.toThrow('disposed');
  });

  it('defers construction failure to the supplied async whole-job fallback', async () => {
    const harness = new WorkerHarness();
    harness.throwOnCreate.add(1);
    const phases: string[] = [];
    const fallback = vi.fn<Job['sequentialFallback']>(async (submitted) =>
      submitted.map((task) => fallbackResult(task)),
    );
    const pool = createPool(harness, 2);

    const pending = pool.submit({
      ...job('construct', 3),
      sequentialFallback: fallback,
      onProgress: (progress) => phases.push(progress.phase),
    });
    expect(fallback).not.toHaveBeenCalled();
    await expect(pending).resolves.toEqual([
      'fallback:construct-0',
      'fallback:construct-1',
      'fallback:construct-2',
    ]);
    expect(fallback).toHaveBeenCalledOnce();
    expect(harness.createCount).toBe(1);
    expect(phases[0]).toBe('parallel');
    expect(phases).toContain('sequential-fallback');
    expect(phases.at(-1)).toBe('sequential-fallback');
  });

  it('discards partial results and reruns the complete job after postMessage fails', async () => {
    const harness = new WorkerHarness();
    const fallback = vi.fn<Job['sequentialFallback']>(async (submitted) =>
      submitted.map((task) => fallbackResult(task)),
    );
    const pool = createPool(harness, 2);
    const pending = pool.submit({ ...job('post', 3), sequentialFallback: fallback });
    const [first, second] = harness.workers;
    if (first === undefined || second === undefined) throw new Error('expected two workers');
    first.throwOnNextPost = true;

    first.reply(0, 'partial');

    await expect(pending).resolves.toEqual([
      'fallback:post-0',
      'fallback:post-1',
      'fallback:post-2',
    ]);
    expect(first.terminated).toBe(true);
    expect(second.terminated).toBe(true);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it.each(['runtime', 'message'] as const)(
    'discards partial results and reruns the complete job after a %s error',
    async (failure) => {
      const harness = new WorkerHarness();
      const phases: string[] = [];
      const fallback = vi.fn<Job['sequentialFallback']>(async (submitted) =>
        submitted.map((task) => fallbackResult(task)),
      );
      const pool = createPool(harness, 2);
      const pending = pool.submit({
        ...job(failure, 3),
        sequentialFallback: fallback,
        onProgress: (progress) => phases.push(progress.phase),
      });
      const [first, second] = harness.workers;
      if (first === undefined || second === undefined) throw new Error('expected two workers');
      first.reply(0, 'partial');

      if (failure === 'runtime') second.runtimeError();
      else second.messageError();
      expect(fallback).not.toHaveBeenCalled();

      await expect(pending).resolves.toEqual([
        `fallback:${failure}-0`,
        `fallback:${failure}-1`,
        `fallback:${failure}-2`,
      ]);
      expect(first.terminated).toBe(true);
      expect(second.terminated).toBe(true);
      expect(fallback).toHaveBeenCalledOnce();
      expect(phases).toContain('parallel');
      expect(phases).toContain('sequential-fallback');
      expect(phases.at(-1)).toBe('sequential-fallback');
    },
  );

  it('treats a worker-reported task error as a whole-job fallback', async () => {
    const harness = new WorkerHarness();
    const pool = createPool(harness, 2);
    const pending = pool.submit(job('reported', 2));
    const request = harness.workers[0]?.posted[0];
    if (request === undefined) throw new Error('expected a posted request');

    harness.workers[0]?.replyRaw({
      kind: 'error',
      submissionId: request.submissionId,
      jobId: request.jobId,
      taskId: request.taskId,
      message: 'planner failed',
    });

    await expect(pending).resolves.toEqual(['fallback:reported-0', 'fallback:reported-1']);
  });
});

function createPool(harness: WorkerHarness, concurrency: number) {
  return new BoundedCompilationWorkerPool<Payload, Result>({
    concurrency,
    createWorker: harness.create,
  });
}

function job(jobId: string, count: number): Job {
  return {
    jobId,
    tasks: tasks(jobId, count),
    sequentialFallback: async (submitted, context) =>
      submitted.map((task, index) => {
        context.reportCompleted(index + 1);
        return fallbackResult(task);
      }),
  };
}

function tasks(prefix: string, count: number): ReadonlyArray<Task> {
  return Array.from({ length: count }, (_, index) => ({
    taskId: `${prefix}-${index}`,
    payload: { value: index },
  }));
}

function fallbackResult(task: Task): Result {
  return `fallback:${String(task.taskId)}`;
}
