import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE, createProject } from '../../core/scene';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { reserveWorkerMemory } from '../worker-memory-lane';
import type { IdleCanvasMotionPlanRequest } from './idle-canvas-motion-plan';
import {
  cancelIdleCanvasMotionPlanOffThread,
  prepareIdleCanvasMotionPlanOffThread,
  resetIdleCanvasMotionWorkerForTests,
} from './idle-canvas-motion-worker-client';
import type {
  IdleCanvasMotionWorkerRequest,
  IdleCanvasMotionWorkerResponse,
} from './idle-canvas-motion-worker-protocol';
import { isCanvasCompilationBridgeConnection } from './canvas-compilation-worker-protocol';

const events: string[] = [];
const cancellations: Array<() => void> = [];
class FakeWorker {
  static instances: FakeWorker[] = [];
  static failure: 'constructor' | 'post' | null = null;
  static replyOnPost = false;
  onmessage: ((event: MessageEvent<IdleCanvasMotionWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly requests: IdleCanvasMotionWorkerRequest[] = [];
  readonly terminate = vi.fn(() => events.push('idle:terminate'));
  constructor() {
    events.push('idle:create');
    if (FakeWorker.failure === 'constructor') throw new Error('constructor failed');
    FakeWorker.instances.push(this);
  }
  postMessage(data: unknown): void {
    if (isCanvasCompilationBridgeConnection(data)) return;
    if (FakeWorker.failure === 'post') throw new Error('post failed');
    this.requests.push(data as IdleCanvasMotionWorkerRequest);
    events.push('idle:post');
    if (FakeWorker.replyOnPost) this.complete();
  }
  get id(): number {
    return this.requests.at(-1)?.id ?? -1;
  }
  send(data: IdleCanvasMotionWorkerResponse): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
  complete(): void {
    this.send({ id: this.id, kind: 'ok', plan: null });
  }
}

const REQUEST: IdleCanvasMotionPlanRequest = {
  project: createProject(),
  outputScope: DEFAULT_OUTPUT_SCOPE,
  placementSettings: DEFAULT_JOB_PLACEMENT,
  resolvedPlacement: { ok: true },
  machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
  statusQuery: 'realtime-report',
  reportInches: false,
};
function request(next: IdleCanvasMotionPlanRequest = REQUEST) {
  const pending = prepareIdleCanvasMotionPlanOffThread(next);
  // Observe early rejections as well as the explicit assertions below.
  void pending?.catch(() => undefined);
  return pending;
}
function worker(): FakeWorker {
  const found = FakeWorker.instances.at(-1);
  if (found === undefined) throw new Error('missing worker');
  return found;
}
function competingWorker(name = 'preparation', onStart?: () => void) {
  const owner: { started: boolean; release: () => void } = {
    started: false,
    release: () => undefined,
  };
  cancellations.push(
    reserveWorkerMemory((release) => {
      owner.started = true;
      owner.release = release;
      events.push(`${name}:start`);
      onStart?.();
    }),
  );
  return owner;
}
beforeEach(() => {
  events.length = 0;
  FakeWorker.instances = [];
  FakeWorker.failure = null;
  FakeWorker.replyOnPost = false;
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  resetIdleCanvasMotionWorkerForTests();
  for (const cancel of cancellations.splice(0)) cancel();
  vi.unstubAllGlobals();
});

describe('idle canvas worker memory ownership', () => {
  it('waits before constructing or cloning, then retires before the next memory owner starts', async () => {
    const preparation = competingWorker();
    const pending = request();
    expect(FakeWorker.instances).toHaveLength(0);
    preparation.release();
    const idle = worker();
    expect(idle.requests[0]?.request).toBe(REQUEST);
    const save = competingWorker('autosave');
    expect(save.started).toBe(false);
    idle.complete();
    await expect(pending).resolves.toBeNull();
    expect(events.slice(-2)).toEqual(['idle:terminate', 'autosave:start']);
    expect(idle.onmessage).toBeNull();
    expect(idle.onerror).toBeNull();
    expect(idle.onmessageerror).toBeNull();
  });

  it('cancels a held reservation without later constructing a worker', async () => {
    const preparation = competingWorker();
    const pending = request();
    cancelIdleCanvasMotionPlanOffThread();
    await expect(pending).rejects.toMatchObject({ name: 'IdleCanvasMotionSupersededError' });
    preparation.release();
    expect(FakeWorker.instances).toHaveLength(0);
    expect(competingWorker('autosave').started).toBe(true);
  });

  it('replaces a held project without jumping ahead of an already waiting owner', async () => {
    const preparation = competingWorker();
    const stale = request();
    const save = competingWorker('autosave');
    const newest = { ...REQUEST, project: createProject() };
    const pending = request(newest);
    await expect(stale).rejects.toMatchObject({ name: 'IdleCanvasMotionSupersededError' });
    preparation.release();
    expect(save.started).toBe(true);
    expect(FakeWorker.instances).toHaveLength(0);
    save.release();
    expect(worker().requests[0]?.request).toBe(newest);
    worker().complete();
    await expect(pending).resolves.toBeNull();
  });

  it('retires active cancellation before releasing the reservation', async () => {
    const pending = request();
    const idle = worker();
    const preparation = competingWorker();
    expect(preparation.started).toBe(false);
    cancelIdleCanvasMotionPlanOffThread();
    await expect(pending).rejects.toMatchObject({ name: 'IdleCanvasMotionSupersededError' });
    expect(idle.terminate).toHaveBeenCalledOnce();
    expect(events.slice(-2)).toEqual(['idle:terminate', 'preparation:start']);
  });

  it.each(['response', 'constructor', 'bridge', 'post', 'error', 'messageerror'] as const)(
    'releases a failed %s request and permits a fresh retry',
    async (failure) => {
      const blocker = competingWorker('blocker');
      const pending = request();
      const assertion = expect(pending).rejects.toBeInstanceOf(Error);
      const preparation = competingWorker();
      if (failure === 'constructor' || failure === 'post') FakeWorker.failure = failure;
      if (failure === 'bridge') {
        vi.stubGlobal(
          'MessageChannel',
          vi.fn(function unavailableMessageChannel() {
            throw new Error('bridge failed');
          }),
        );
      }
      blocker.release();
      if (failure === 'response') {
        worker().send({ id: worker().id, kind: 'error', message: 'compile failed' });
      }
      if (failure === 'error') worker().onerror?.();
      if (failure === 'messageerror') worker().onmessageerror?.();
      await assertion;
      expect(preparation.started).toBe(true);
      if (failure !== 'constructor') {
        expect(worker().terminate).toHaveBeenCalledOnce();
        expect(events.slice(-2)).toEqual(['idle:terminate', 'preparation:start']);
      }
      if (failure === 'bridge') {
        vi.unstubAllGlobals();
        vi.stubGlobal('Worker', FakeWorker);
      }
      FakeWorker.failure = null;
      preparation.release();
      const retry = request();
      worker().complete();
      await expect(retry).resolves.toBeNull();
    },
  );

  it('ignores retired callbacks while the replacement owns memory', async () => {
    const stale = request();
    const retired = worker();
    const lateMessage = retired.onmessage;
    const lateError = retired.onerror;
    const lateMessageError = retired.onmessageerror;
    const pending = request({ ...REQUEST, project: createProject() });
    await expect(stale).rejects.toMatchObject({ name: 'IdleCanvasMotionSupersededError' });
    const newest = worker();
    const save = competingWorker('autosave');
    lateMessage?.(
      new MessageEvent('message', { data: { id: retired.id, kind: 'ok', plan: null } }),
    );
    lateError?.();
    lateMessageError?.();
    expect(newest.terminate).not.toHaveBeenCalled();
    expect(save.started).toBe(false);
    newest.complete();
    await expect(pending).resolves.toBeNull();
    expect(save.started).toBe(true);
  });

  it('does not retain a reservation after a synchronous completion during dispatch', async () => {
    FakeWorker.replyOnPost = true;
    await expect(request()).resolves.toBeNull();
    expect(worker().terminate).toHaveBeenCalledOnce();
    const preparation = competingWorker();
    expect(preparation.started).toBe(true);
    const pending = request();
    expect(FakeWorker.instances).toHaveLength(1);
    preparation.release();
    await expect(pending).resolves.toBeNull();
    expect(FakeWorker.instances).toHaveLength(2);
    expect(competingWorker('autosave').started).toBe(true);
  });

  it('preserves a newer request created reentrantly while supersession releases memory', async () => {
    const stale = request();
    let newest: ReturnType<typeof request> = null;
    const save = competingWorker('autosave', () => {
      newest = request({ ...REQUEST, project: createProject() });
    });
    const superseded = request({ ...REQUEST, project: createProject() });
    await expect(stale).rejects.toMatchObject({ name: 'IdleCanvasMotionSupersededError' });
    await expect(superseded).rejects.toMatchObject({ name: 'IdleCanvasMotionSupersededError' });
    expect(save.started).toBe(true);
    expect(FakeWorker.instances).toHaveLength(1);
    save.release();
    expect(FakeWorker.instances).toHaveLength(2);
    worker().complete();
    await expect(newest).resolves.toBeNull();
  });
});
