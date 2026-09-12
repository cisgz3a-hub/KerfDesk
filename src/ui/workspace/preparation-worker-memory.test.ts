import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { reserveWorkerMemory } from '../worker-memory-lane';
import { isCanvasCompilationBridgeConnection } from './canvas-compilation-worker-protocol';
import {
  prepareJobEstimateOffThread,
  prepareLargeJobOffThread,
  resetPreparationWorkerForTests,
  SUPERSEDE_QUIET_WINDOW_MS,
} from './preparation-worker-client';
import type {
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';
import type { PreparationTransferAcknowledgement } from './preparation-transfer-protocol';

const events: string[] = [];
const cancellations: Array<() => void> = [];
class FakeWorker {
  static instances: FakeWorker[] = [];
  static failure: 'constructor' | 'post' | null = null;
  onmessage: ((event: MessageEvent<PreparationWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly requests: PreparationWorkerRequest[] = [];
  readonly acknowledgements: PreparationTransferAcknowledgement[] = [];
  readonly terminate = vi.fn(() => events.push('preview:terminate'));
  constructor() {
    events.push('preview:create');
    if (FakeWorker.failure === 'constructor') throw new Error('constructor failed');
    FakeWorker.instances.push(this);
  }
  postMessage(data: PreparationWorkerRequest | PreparationTransferAcknowledgement): void {
    if (isCanvasCompilationBridgeConnection(data)) return;
    if ('kind' in data) {
      this.acknowledgements.push(data);
      events.push(`ack:${data.sequence}`);
      return;
    }
    if (FakeWorker.failure === 'post') throw new Error('post failed');
    this.requests.push(data);
    events.push('preview:post');
  }
  get id(): number {
    return this.requests.at(-1)?.id ?? -1;
  }
  send(data: PreparationWorkerResponse): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
  complete(): void {
    this.send({ id: this.id, kind: 'ok', ...result });
  }
}

const result = {
  estimate: { kind: 'empty' as const },
  jobOriginOffset: { x: 12.5, y: -8.125 },
  toolpath: {
    totalLength: 10,
    steps: [{ kind: 'travel' as const, from: { x: -0, y: 2.25 }, to: { x: 7, y: 9 }, length: 10 }],
  },
};
const origin = { jobOrigin: { startFrom: 'user-origin' as const, anchor: 'center' as const } };
function worker(): FakeWorker {
  const found = FakeWorker.instances.at(-1);
  if (found === undefined) throw new Error('no worker');
  return found;
}
function competingWorker(name = 'autosave'): { release: () => void; started: boolean } {
  const owner: { release: () => void; started: boolean } = {
    release: () => undefined,
    started: false,
  };
  cancellations.push(
    reserveWorkerMemory((release) => {
      owner.started = true;
      owner.release = release;
      events.push(`${name}:start`);
    }),
  );
  return owner;
}
beforeEach(() => {
  events.length = 0;
  FakeWorker.instances = [];
  FakeWorker.failure = null;
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  resetPreparationWorkerForTests();
  for (const cancel of cancellations.splice(0)) cancel();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('preparation worker memory ownership', () => {
  it('acknowledges and retires a complete transfer before autosave; a queued preview waits', async () => {
    const project = createProject();
    const first = prepareLargeJobOffThread(project);
    const initial = worker();
    const save = competingWorker();
    const next = prepareLargeJobOffThread(project, origin);
    initial.send({
      id: initial.id,
      sequence: 0,
      kind: 'transfer-start',
      header: {
        estimate: result.estimate,
        jobOriginOffset: result.jobOriginOffset,
        toolpath: { totalLength: 10 },
        stepCount: 1,
      },
    });
    initial.send({
      id: initial.id,
      sequence: 1,
      kind: 'transfer-chunk',
      route: 'legacy',
      offset: 0,
      steps: result.toolpath.steps,
    });
    expect(save.started).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
    initial.send({ id: initial.id, sequence: 2, kind: 'transfer-complete' });
    await expect(first).resolves.toStrictEqual(result);
    expect(events.slice(-3)).toEqual(['ack:2', 'preview:terminate', 'autosave:start']);
    expect(initial.onmessage).toBeNull();
    expect(initial.onerror).toBeNull();
    expect(initial.onmessageerror).toBeNull();
    expect(FakeWorker.instances).toHaveLength(1);
    save.release();
    expect(FakeWorker.instances).toHaveLength(2);
    expect(worker().requests[0]?.jobOrigin).toEqual(origin.jobOrigin);
    worker().complete();
    await expect(next).resolves.toStrictEqual(result);
  });

  it.each(['preview', 'estimate'] as const)(
    'retires an unchunked %s before releasing memory',
    async (projection) => {
      const pending =
        projection === 'preview'
          ? prepareLargeJobOffThread(createProject())
          : prepareJobEstimateOffThread(createProject());
      const initial = worker();
      const save = competingWorker();
      if (projection === 'preview') initial.complete();
      else initial.send({ id: initial.id, kind: 'estimate', estimate: result.estimate });
      await expect(pending).resolves.toBeDefined();
      expect(initial.terminate).toHaveBeenCalledOnce();
      expect(events.slice(-2)).toEqual(['preview:terminate', 'autosave:start']);
      save.release();
    },
  );

  it('coalesces held options before constructing or cloning a project', async () => {
    const save = competingWorker();
    const project = createProject();
    const stale = prepareLargeJobOffThread(project);
    const latest = prepareLargeJobOffThread(project, origin);
    await expect(stale).rejects.toThrow('superseded by a newer request');
    expect(FakeWorker.instances).toHaveLength(0);
    expect(prepareLargeJobOffThread(project, origin)).toBe(latest);
    save.release();
    expect(worker().requests).toHaveLength(1);
    expect(worker().requests[0]?.project).toBe(project);
    expect(worker().requests[0]?.jobOrigin).toEqual(origin.jobOrigin);
    worker().complete();
    await expect(latest).resolves.toStrictEqual(result);
  });

  it('gives waiting autosave a turn on supersede and ignores retired callbacks', async () => {
    vi.useFakeTimers();
    const stale = prepareLargeJobOffThread(createProject());
    const initial = worker();
    const lateMessage = initial.onmessage;
    const lateError = initial.onerror;
    const lateMessageError = initial.onmessageerror;
    const save = competingWorker();
    const latest = prepareLargeJobOffThread(createProject());
    await expect(stale).rejects.toThrow('superseded by a newer project');
    expect(save.started).toBe(true);
    vi.advanceTimersByTime(SUPERSEDE_QUIET_WINDOW_MS);
    expect(FakeWorker.instances).toHaveLength(1);
    save.release();
    const replacement = worker();
    expect(replacement).not.toBe(initial);
    lateMessage?.(
      new MessageEvent<PreparationWorkerResponse>('message', {
        data: { id: initial.id, kind: 'ok', ...result },
      }),
    );
    lateError?.();
    lateMessageError?.();
    expect(replacement.terminate).not.toHaveBeenCalled();
    const waiting = competingWorker('next-save');
    expect(waiting.started).toBe(false);
    replacement.complete();
    await expect(latest).resolves.toStrictEqual(result);
    expect(waiting.started).toBe(true);
    waiting.release();
  });

  it('cancels an ungranted stale reservation without jumping ahead of a waiting save', async () => {
    vi.useFakeTimers();
    const activeSave = competingWorker('active-save');
    const stale = prepareLargeJobOffThread(createProject());
    const waitingSave = competingWorker('waiting-save');
    const latest = prepareLargeJobOffThread(createProject());
    await expect(stale).rejects.toThrow('superseded by a newer project');
    vi.advanceTimersByTime(SUPERSEDE_QUIET_WINDOW_MS);
    activeSave.release();
    expect(waitingSave.started).toBe(true);
    expect(FakeWorker.instances).toHaveLength(0);
    resetPreparationWorkerForTests();
    await expect(latest).rejects.toThrow('preparation worker reset');
    waitingSave.release();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it.each(['constructor', 'bridge', 'post', 'error', 'messageerror', 'protocol'] as const)(
    'releases a failed %s reservation and allows a clean retry',
    async (failure) => {
      const blocker = competingWorker('prior-save');
      const project = createProject();
      const pending = prepareLargeJobOffThread(project);
      const failureAssertion = expect(pending).rejects.toBeInstanceOf(Error);
      const save = competingWorker();
      if (failure === 'constructor' || failure === 'post') FakeWorker.failure = failure;
      if (failure === 'bridge') {
        vi.stubGlobal(
          'MessageChannel',
          vi.fn(function unavailableMessageChannel() {
            throw new Error('bridge startup failed');
          }),
        );
      }
      blocker.release();
      if (failure === 'error') worker().onerror?.();
      if (failure === 'messageerror') worker().onmessageerror?.();
      if (failure === 'protocol') {
        worker().send({ id: worker().id, sequence: 1, kind: 'transfer-complete' });
      }
      await failureAssertion;
      expect(save.started).toBe(true);
      if (failure === 'bridge') {
        expect(worker().terminate).toHaveBeenCalledOnce();
        expect(events.slice(-2)).toEqual(['preview:terminate', 'autosave:start']);
        vi.unstubAllGlobals();
        vi.stubGlobal('Worker', FakeWorker);
      }
      FakeWorker.failure = null;
      save.release();
      const retry = prepareLargeJobOffThread(project);
      expect(retry).not.toBe(pending);
      worker().complete();
      await expect(retry).resolves.toStrictEqual(result);
    },
  );

  it('serves a settled full cache hit without reserving or constructing a worker', async () => {
    const project = createProject();
    const full = prepareLargeJobOffThread(project);
    worker().complete();
    await expect(full).resolves.toStrictEqual(result);
    const save = competingWorker();
    expect(prepareLargeJobOffThread(project)).toBe(full);
    expect(prepareJobEstimateOffThread(project)).toBe(full);
    expect(FakeWorker.instances).toHaveLength(1);
    save.release();
    expect(FakeWorker.instances).toHaveLength(1);
  });
});
