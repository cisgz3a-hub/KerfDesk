import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { reserveWorkerMemory } from '../worker-memory-lane';
import { resetCanvasCompilationMainBridgeForTests } from './canvas-compilation-main-bridge';
import { isCanvasCompilationBridgeConnection } from './canvas-compilation-worker-protocol';
import {
  prepareJobEstimateOffThread,
  prepareLargeJobOffThread,
  resetPreparationWorkerForTests,
} from './preparation-worker-client';
import type {
  PreparationPreviewUpgrade,
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static peakLive = 0;
  onmessage: ((event: MessageEvent<PreparationWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly requests: PreparationWorkerRequest[] = [];
  readonly upgrades: PreparationPreviewUpgrade[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
    FakeWorker.peakLive = Math.max(
      FakeWorker.peakLive,
      FakeWorker.instances.filter((worker) => !worker.terminated).length,
    );
  }
  postMessage(data: unknown): void {
    if (isCanvasCompilationBridgeConnection(data)) return;
    if (typeof data === 'object' && data !== null && 'kind' in data)
      this.upgrades.push(data as PreparationPreviewUpgrade);
    else this.requests.push(data as PreparationWorkerRequest);
  }
  terminate(): void {
    this.terminated = true;
  }
  send(kind: 'ok' | 'estimate-ready' = 'ok'): void {
    const id = this.requests[0]?.id ?? -1;
    this.onmessage?.(
      new MessageEvent('message', {
        data: kind === 'ok' ? { id, kind, ...result } : { id, kind, estimate: result.estimate },
      }),
    );
  }
}

const result = { estimate: { kind: 'empty' as const }, toolpath: { steps: [], totalLength: 0 } };
const releases: Array<() => void> = [];
function worker(): FakeWorker {
  const current = FakeWorker.instances.at(-1);
  if (current === undefined) throw new Error('No preparation worker.');
  return current;
}
function interactive(): () => void {
  const release = reserveWorkerMemory(() => undefined, { priority: 'interactive' });
  releases.push(release);
  return release;
}

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.peakLive = 0;
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  resetPreparationWorkerForTests();
  for (const release of releases.splice(0)) release();
  resetCanvasCompilationMainBridgeForTests();
  vi.unstubAllGlobals();
});

describe('shared preparation consumer ownership', () => {
  it('closing Preview preserves an independently owned live ETA', async () => {
    const project = createProject();
    const previewOwner = new AbortController();
    const estimateOwner = new AbortController();
    const preview = prepareLargeJobOffThread(project, {}, undefined, previewOwner.signal);
    const estimate = prepareJobEstimateOffThread(project, {}, estimateOwner.signal);
    const original = worker();
    previewOwner.abort();
    await expect(preview).rejects.toMatchObject({ reason: 'consumer-cancelled' });
    expect(original.terminated).toBe(false);
    original.send();
    await expect(estimate).resolves.toEqual(result);
    expect(original.terminated).toBe(true);
  });

  it('last consumer cancellation retires the heap and invalidates reuse synchronously', async () => {
    const project = createProject();
    const first = new AbortController();
    const second = new AbortController();
    const a = prepareJobEstimateOffThread(project, {}, first.signal);
    const b = prepareJobEstimateOffThread(project, {}, second.signal);
    const original = worker();
    first.abort();
    await expect(a).rejects.toMatchObject({ reason: 'consumer-cancelled' });
    expect(original.terminated).toBe(false);
    second.abort();
    const replacement = prepareJobEstimateOffThread(project);
    await expect(b).rejects.toMatchObject({ reason: 'consumer-cancelled' });
    expect(original.terminated).toBe(true);
    expect(worker()).not.toBe(original);
    worker().send('estimate-ready');
    await expect(replacement).resolves.toEqual({ estimate: result.estimate });
  });

  it('does not build Preview after its owner cancels an active estimate upgrade', async () => {
    const project = createProject();
    const estimate = prepareJobEstimateOffThread(project);
    const previewOwner = new AbortController();
    const preview = prepareLargeJobOffThread(project, {}, undefined, previewOwner.signal);
    previewOwner.abort();
    await expect(preview).rejects.toMatchObject({ reason: 'consumer-cancelled' });
    const original = worker();
    original.send('estimate-ready');
    await expect(estimate).resolves.toEqual({ estimate: result.estimate });
    expect(original.upgrades).toEqual([]);
    expect(original.terminated).toBe(true);
    await expect(prepareJobEstimateOffThread(project)).resolves.toEqual({
      estimate: result.estimate,
    });
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('dispatches only ETA when a queued Preview upgrade loses its last dependent owner', async () => {
    const release = interactive();
    const project = createProject();
    const estimate = prepareJobEstimateOffThread(project);
    const previewOwner = new AbortController();
    const preview = prepareLargeJobOffThread(project, {}, undefined, previewOwner.signal);
    previewOwner.abort();
    await expect(preview).rejects.toMatchObject({ reason: 'consumer-cancelled' });
    expect(FakeWorker.instances).toHaveLength(0);
    release();
    const original = worker();
    expect(original.requests[0]?.projection).toBe('estimate');
    original.send('estimate-ready');
    await expect(estimate).resolves.toEqual({ estimate: result.estimate });
    expect(original.upgrades).toEqual([]);
    expect(original.terminated).toBe(true);
    await expect(prepareJobEstimateOffThread(project)).resolves.toEqual({
      estimate: result.estimate,
    });
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('allows a new Preview to join after a queued request was downgraded to ETA', async () => {
    const release = interactive();
    const project = createProject();
    const estimate = prepareJobEstimateOffThread(project);
    const owner = new AbortController();
    const cancelledPreview = prepareLargeJobOffThread(project, {}, undefined, owner.signal);
    owner.abort();
    await expect(cancelledPreview).rejects.toMatchObject({ reason: 'consumer-cancelled' });
    release();
    expect(worker().requests[0]?.projection).toBe('estimate');
    const preview = prepareLargeJobOffThread(project);
    worker().send('estimate-ready');
    expect(worker().upgrades).toHaveLength(1);
    expect(worker().terminated).toBe(false);
    worker().send();
    await expect(preview).resolves.toEqual(result);
    await expect(estimate).resolves.toEqual(result);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('keeps queued Preview when a later ETA depends on its full-result promise', async () => {
    const release = interactive();
    const project = createProject();
    const earlyEstimate = prepareJobEstimateOffThread(project);
    const previewOwner = new AbortController();
    const preview = prepareLargeJobOffThread(project, {}, undefined, previewOwner.signal);
    const lateEstimate = prepareJobEstimateOffThread(project);
    previewOwner.abort();
    await expect(preview).rejects.toMatchObject({ reason: 'consumer-cancelled' });
    release();
    expect(worker().requests[0]?.projection ?? 'preview').toBe('preview');
    worker().send();
    await expect(earlyEstimate).resolves.toEqual(result);
    await expect(lateEstimate).resolves.toEqual(result);
    expect(worker().terminated).toBe(true);
  });

  it('preserves a later ETA sharing the upgraded Preview promise when Preview closes', async () => {
    const project = createProject();
    const earlyEstimate = prepareJobEstimateOffThread(project);
    const previewOwner = new AbortController();
    const preview = prepareLargeJobOffThread(project, {}, undefined, previewOwner.signal);
    const lateEstimate = prepareJobEstimateOffThread(project);
    previewOwner.abort();
    await expect(preview).rejects.toMatchObject({ reason: 'consumer-cancelled' });
    const original = worker();
    original.send('estimate-ready');
    await expect(earlyEstimate).resolves.toEqual({ estimate: result.estimate });
    expect(original.terminated).toBe(false);
    expect(original.upgrades).toHaveLength(1);
    original.send();
    await expect(lateEstimate).resolves.toEqual(result);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('publishes the scalar cache before a lane handoff requests the same Preview reentrantly', async () => {
    const project = createProject();
    const estimate = prepareJobEstimateOffThread(project);
    const previewOwner = new AbortController();
    const cancelledPreview = prepareLargeJobOffThread(project, {}, undefined, previewOwner.signal);
    previewOwner.abort();
    await expect(cancelledPreview).rejects.toMatchObject({ reason: 'consumer-cancelled' });
    let replacement: ReturnType<typeof prepareLargeJobOffThread> = null;
    releases.push(
      reserveWorkerMemory((release) => {
        replacement = prepareLargeJobOffThread(project);
        void replacement?.catch(() => undefined);
        release();
      }),
    );
    const original = worker();
    original.send('estimate-ready');
    await expect(estimate).resolves.toEqual({ estimate: result.estimate });
    expect(original.terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(worker().requests[0]?.projection ?? 'preview').toBe('preview');
    expect(prepareLargeJobOffThread(project)).toBe(replacement);
    worker().send();
    await expect(replacement).resolves.toEqual(result);
    expect(prepareLargeJobOffThread(project)).toBe(replacement);
    expect(FakeWorker.peakLive).toBe(1);
  });

  it('restarts useful work after repeated interactive preemption without concurrent heaps or stale results', async () => {
    const pending = prepareLargeJobOffThread(createProject());
    for (let index = 0; index < 3; index++) {
      const stale = worker();
      const late = stale.onmessage;
      const release = interactive();
      expect(stale.terminated).toBe(true);
      const instancesWhileInteractive = FakeWorker.instances.length;
      const secondInteractive = interactive();
      release();
      expect(FakeWorker.instances).toHaveLength(instancesWhileInteractive);
      secondInteractive();
      expect(worker()).not.toBe(stale);
      late?.(
        new MessageEvent('message', {
          data: { id: stale.requests[0]?.id ?? -1, kind: 'ok', ...result },
        }),
      );
      expect(worker().terminated).toBe(false);
    }
    worker().send();
    await expect(pending).resolves.toEqual(result);
    expect(FakeWorker.peakLive).toBe(1);
    expect(FakeWorker.instances).toHaveLength(4);
  });

  it('removes an unowned queued restart before interactive work releases', async () => {
    const controller = new AbortController();
    const pending = prepareLargeJobOffThread(createProject(), {}, undefined, controller.signal);
    const release = interactive();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: 'consumer-cancelled' });
    release();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker().terminated).toBe(true);
  });

  it('keeps an anonymous legacy consumer when a cancellable consumer closes', async () => {
    const project = createProject();
    const stable = prepareJobEstimateOffThread(project);
    expect(prepareJobEstimateOffThread(project)).toBe(stable);
    const controller = new AbortController();
    const observed = prepareJobEstimateOffThread(project, {}, controller.signal);
    controller.abort();
    await expect(observed).rejects.toMatchObject({ reason: 'consumer-cancelled' });
    expect(worker().terminated).toBe(false);
    worker().send('estimate-ready');
    await expect(stable).resolves.toEqual({ estimate: result.estimate });
  });
});
