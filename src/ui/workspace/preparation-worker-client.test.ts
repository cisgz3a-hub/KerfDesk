import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import {
  prepareLargeJobOffThread,
  resetPreparationWorkerForTests,
  type LargeJobPreparation,
} from './preparation-worker-client';
import type { PreparationWorkerResponse } from './preparation-worker-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<PreparationWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: Array<{ id: number }> = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(data: { id: number }): void {
    this.posted.push(data);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: PreparationWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<PreparationWorkerResponse>);
  }
}

const okResult = {
  toolpath: { steps: [], totalLength: 42 },
  estimate: { kind: 'estimated', label: '1m 0s', totalSeconds: 60 },
};

function lastWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error('no worker spawned');
  return worker;
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  resetPreparationWorkerForTests();
  vi.unstubAllGlobals();
});

describe('prepareLargeJobOffThread', () => {
  it('returns null when the environment has no Worker', () => {
    vi.unstubAllGlobals();
    expect(prepareLargeJobOffThread(createProject())).toBeNull();
  });

  it('resolves with the worker response', async () => {
    const promise = prepareLargeJobOffThread(createProject());
    if (promise === null) throw new Error('expected a worker request');
    const worker = lastWorker();
    const id = worker.posted[0]?.id ?? -1;
    worker.respond({ id, kind: 'ok', ...okResult } as PreparationWorkerResponse);
    const prepared: LargeJobPreparation = await promise;
    expect(prepared.toolpath.totalLength).toBe(42);
    expect(prepared.estimate.kind).toBe('estimated');
  });

  it('shares one in-flight request per project + options (preview and estimate)', () => {
    const project = createProject();
    const first = prepareLargeJobOffThread(project);
    const second = prepareLargeJobOffThread(project);
    expect(second).toBe(first);
    expect(lastWorker().posted).toHaveLength(1);
  });

  it('queues requests with different options for the same project', async () => {
    const project = createProject();
    const first = prepareLargeJobOffThread(project);
    const second = prepareLargeJobOffThread(project, {
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
    });
    expect(second).not.toBe(first);
    const worker = lastWorker();
    expect(worker.posted).toHaveLength(2);
    expect(worker.terminated).toBe(false);
    // Both settle independently as the worker drains its queue.
    worker.respond({
      id: worker.posted[0]?.id ?? -1,
      kind: 'ok',
      ...okResult,
    } as PreparationWorkerResponse);
    worker.respond({
      id: worker.posted[1]?.id ?? -1,
      kind: 'ok',
      ...okResult,
    } as PreparationWorkerResponse);
    await expect(first).resolves.toBeDefined();
    await expect(second).resolves.toBeDefined();
  });

  it('terminates the worker and rejects stale requests when the project changes', async () => {
    const first = prepareLargeJobOffThread(createProject());
    if (first === null) throw new Error('expected a worker request');
    const firstWorker = lastWorker();
    const second = prepareLargeJobOffThread(createProject());
    if (second === null) throw new Error('expected a worker request');
    await expect(first).rejects.toThrow('superseded');
    expect(firstWorker.terminated).toBe(true);
    expect(lastWorker()).not.toBe(firstWorker);
  });

  it('rejects on a worker error response', async () => {
    const promise = prepareLargeJobOffThread(createProject());
    if (promise === null) throw new Error('expected a worker request');
    const worker = lastWorker();
    worker.respond({
      id: worker.posted[0]?.id ?? -1,
      kind: 'error',
      message: 'compile exploded',
    });
    await expect(promise).rejects.toThrow('compile exploded');
  });

  it('re-requests after a rejection instead of returning the failed promise', async () => {
    const project = createProject();
    const failed = prepareLargeJobOffThread(project);
    if (failed === null) throw new Error('expected a worker request');
    const worker = lastWorker();
    worker.respond({ id: worker.posted[0]?.id ?? -1, kind: 'error', message: 'boom' });
    await expect(failed).rejects.toThrow('boom');
    const retried = prepareLargeJobOffThread(project);
    expect(retried).not.toBe(failed);
  });
});
