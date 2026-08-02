import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import {
  isPreparationSuperseded,
  PreparationSupersededError,
  prepareLargeJobOffThread,
  resetPreparationWorkerForTests,
  SUPERSEDE_QUIET_WINDOW_MS,
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
  vi.useRealTimers();
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

  it('holds a same-project request with different options until the active compute settles', async () => {
    const project = createProject();
    const first = prepareLargeJobOffThread(project);
    const second = prepareLargeJobOffThread(project, {
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
    });
    expect(second).not.toBe(first);
    const worker = lastWorker();
    // Only the active compute is posted; the second request is held so a
    // newer key can still supersede it before the worker ever starts it.
    expect(worker.posted).toHaveLength(1);
    expect(worker.terminated).toBe(false);
    worker.respond({
      id: worker.posted[0]?.id ?? -1,
      kind: 'ok',
      ...okResult,
    } as PreparationWorkerResponse);
    await expect(first).resolves.toBeDefined();
    // The held request dispatches once the active compute settles.
    expect(worker.posted).toHaveLength(2);
    worker.respond({
      id: worker.posted[1]?.id ?? -1,
      kind: 'ok',
      ...okResult,
    } as PreparationWorkerResponse);
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

  it('respawns eagerly on supersede but delays dispatch behind the quiet window', async () => {
    vi.useFakeTimers();
    const first = prepareLargeJobOffThread(createProject());
    if (first === null) throw new Error('expected a worker request');
    // A request that supersedes nothing dispatches immediately.
    expect(lastWorker().posted).toHaveLength(1);
    const second = prepareLargeJobOffThread(createProject());
    if (second === null) throw new Error('expected a worker request');
    await expect(first).rejects.toThrow('superseded by a newer project');
    // The replacement worker spawns immediately (module-graph load overlaps
    // the quiet window), but nothing is posted until the window elapses.
    expect(FakeWorker.instances).toHaveLength(2);
    const worker = lastWorker();
    expect(worker.posted).toHaveLength(0);
    vi.advanceTimersByTime(SUPERSEDE_QUIET_WINDOW_MS);
    expect(worker.posted).toHaveLength(1);
    worker.respond({
      id: worker.posted[0]?.id ?? -1,
      kind: 'ok',
      ...okResult,
    } as PreparationWorkerResponse);
    await expect(second).resolves.toBeDefined();
  });

  it('coalesces a burst of new-project supersedes into one restart and one dispatch', async () => {
    vi.useFakeTimers();
    const first = prepareLargeJobOffThread(createProject());
    if (first === null) throw new Error('expected a worker request');
    const stale = prepareLargeJobOffThread(createProject());
    if (stale === null) throw new Error('expected a worker request');
    vi.advanceTimersByTime(SUPERSEDE_QUIET_WINDOW_MS / 2);
    const latest = prepareLargeJobOffThread(createProject());
    if (latest === null) throw new Error('expected a worker request');
    await expect(first).rejects.toThrow('superseded by a newer project');
    await expect(stale).rejects.toThrow('superseded by a newer project');
    // The second supersede found an idle worker: no second termination.
    expect(FakeWorker.instances).toHaveLength(2);
    // The original deadline passes without a dispatch — the window was reset.
    vi.advanceTimersByTime(SUPERSEDE_QUIET_WINDOW_MS / 2);
    expect(lastWorker().posted).toHaveLength(0);
    vi.advanceTimersByTime(SUPERSEDE_QUIET_WINDOW_MS / 2);
    const worker = lastWorker();
    expect(worker.posted).toHaveLength(1);
    worker.respond({
      id: worker.posted[0]?.id ?? -1,
      kind: 'ok',
      ...okResult,
    } as PreparationWorkerResponse);
    await expect(latest).resolves.toBeDefined();
  });

  it('rejects stale queued same-project requests, keeping only the active compute', async () => {
    const project = createProject();
    const active = prepareLargeJobOffThread(project);
    if (active === null) throw new Error('expected a worker request');
    const staleQueued = prepareLargeJobOffThread(project, {
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
    });
    if (staleQueued === null) throw new Error('expected a worker request');
    const latest = prepareLargeJobOffThread(project, {
      jobOrigin: { startFrom: 'user-origin', anchor: 'center' },
    });
    if (latest === null) throw new Error('expected a worker request');
    const worker = lastWorker();
    // Only the active compute was ever posted; the stale hold-back entry was
    // rejected when the newer same-project request arrived.
    expect(worker.posted).toHaveLength(1);
    expect(worker.terminated).toBe(false);
    await expect(staleQueued).rejects.toThrow('superseded by a newer request');
    worker.respond({
      id: worker.posted[0]?.id ?? -1,
      kind: 'ok',
      ...okResult,
    } as PreparationWorkerResponse);
    await expect(active).resolves.toBeDefined();
    // The latest request dispatches once the active compute settles.
    expect(worker.posted).toHaveLength(2);
    worker.respond({
      id: worker.posted[1]?.id ?? -1,
      kind: 'ok',
      ...okResult,
    } as PreparationWorkerResponse);
    await expect(latest).resolves.toBeDefined();
  });

  it('marks an internally coalesced same-project supersede as superseded, not failed', async () => {
    const project = createProject();
    const active = prepareLargeJobOffThread(project);
    if (active === null) throw new Error('expected a worker request');
    const held = prepareLargeJobOffThread(project, {
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
    });
    if (held === null) throw new Error('expected a worker request');
    const latest = prepareLargeJobOffThread(project, {
      jobOrigin: { startFrom: 'user-origin', anchor: 'center' },
    });
    if (latest === null) throw new Error('expected a worker request');
    const error = await held.catch((err: unknown) => err);
    expect(isPreparationSuperseded(error)).toBe(true);
    expect(error instanceof PreparationSupersededError ? error.reason : null).toBe('newer-request');
  });

  it('marks a different-project supersede as superseded — the scene changed, nothing failed', async () => {
    const first = prepareLargeJobOffThread(createProject());
    if (first === null) throw new Error('expected a worker request');
    const second = prepareLargeJobOffThread(createProject());
    if (second === null) throw new Error('expected a worker request');
    const error = await first.catch((err: unknown) => err);
    expect(isPreparationSuperseded(error)).toBe(true);
    expect(error instanceof PreparationSupersededError ? error.reason : null).toBe('newer-project');
  });

  it('does NOT mark a real worker failure as superseded', async () => {
    const promise = prepareLargeJobOffThread(createProject());
    if (promise === null) throw new Error('expected a worker request');
    const worker = lastWorker();
    worker.respond({ id: worker.posted[0]?.id ?? -1, kind: 'error', message: 'compile exploded' });
    const error = await promise.catch((err: unknown) => err);
    expect(isPreparationSuperseded(error)).toBe(false);
    expect(error).toBeInstanceOf(Error);
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
