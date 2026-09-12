import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import {
  MAX_SETTLED_PREPARATIONS,
  prepareJobEstimateOffThread,
  prepareLargeJobOffThread,
  resetPreparationWorkerForTests,
  SUPERSEDE_QUIET_WINDOW_MS,
} from './preparation-worker-client';
import type {
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';
import { isCanvasCompilationBridgeConnection } from './canvas-compilation-worker-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<PreparationWorkerResponse>) => void) | null = null;
  posted: PreparationWorkerRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(data: unknown): void {
    if (!isCanvasCompilationBridgeConnection(data))
      this.posted.push(data as PreparationWorkerRequest);
  }
  terminate(): void {
    this.terminated = true;
  }
  respond(projection: 'estimate' | 'preview' = 'estimate'): void {
    this.send(
      projection === 'estimate'
        ? { id: this.posted.at(-1)?.id ?? -1, kind: 'estimate', estimate }
        : { id: this.posted.at(-1)?.id ?? -1, kind: 'ok', estimate, toolpath },
    );
  }
  send(data: PreparationWorkerResponse): void {
    this.onmessage?.({ data } as MessageEvent<PreparationWorkerResponse>);
  }
}

const estimate = { kind: 'empty' as const };
const toolpath = { steps: [], totalLength: 42 };
const origin = { jobOrigin: { startFrom: 'user-origin' as const, anchor: 'center' as const } };
function worker(): FakeWorker {
  const instance = FakeWorker.instances.at(-1);
  if (instance === undefined) throw new Error('worker missing');
  return instance;
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

describe('estimate-only preparation client', () => {
  it('returns null without Worker and does not run preparation inline', () => {
    vi.unstubAllGlobals();
    expect(prepareJobEstimateOffThread(createProject())).toBeNull();
  });

  it('requests and caches an estimate without preview geometry', async () => {
    const project = createProject();
    const first = prepareJobEstimateOffThread(project);
    expect(prepareJobEstimateOffThread(project)).toBe(first);
    expect(worker().posted).toHaveLength(1);
    expect(worker().posted[0]?.projection).toBe('estimate');
    worker().respond();
    await expect(first).resolves.toEqual({ estimate });
    expect(prepareJobEstimateOffThread(project)).toBe(first);
    expect(worker().posted).toHaveLength(1);
  });

  it('shares both in-flight and settled full Preview results with ETA', async () => {
    const project = createProject();
    const full = prepareLargeJobOffThread(project, origin);
    expect(prepareJobEstimateOffThread(project, origin)).toBe(full);
    expect(worker().posted).toHaveLength(1);
    expect(worker().posted[0]?.projection).toBeUndefined();
    worker().respond('preview');
    await expect(full).resolves.toEqual({ toolpath, estimate });
    expect(prepareJobEstimateOffThread(project, origin)).toBe(full);
  });

  it('does not return a cached estimate as a Preview', async () => {
    const project = createProject();
    const small = prepareJobEstimateOffThread(project);
    worker().respond();
    await small;
    const full = prepareLargeJobOffThread(project);
    expect(full).not.toBe(small);
    expect(worker().posted).toHaveLength(2);
    expect(worker().posted[1]?.projection).toBeUndefined();
    worker().respond('preview');
    await expect(full).resolves.toEqual({ toolpath, estimate });
    expect(prepareJobEstimateOffThread(project)).toBe(full);
  });

  it('finishes an active estimate before a newly requested full Preview without downgrading its cache', async () => {
    const project = createProject();
    const small = prepareJobEstimateOffThread(project);
    const full = prepareLargeJobOffThread(project);
    expect(worker().posted).toHaveLength(1);
    worker().respond();
    await expect(small).resolves.toEqual({ estimate });
    expect(worker().posted).toHaveLength(2);
    expect(prepareLargeJobOffThread(project)).toBe(full);
    expect(prepareJobEstimateOffThread(project)).toBe(full);
    worker().respond('preview');
    await expect(full).resolves.toEqual({ toolpath, estimate });
  });

  it('promotes a held estimate to full Preview and settles both consumers from one response', async () => {
    const project = createProject();
    const active = prepareJobEstimateOffThread(project);
    const heldEstimate = prepareJobEstimateOffThread(project, origin);
    const heldPreview = prepareLargeJobOffThread(project, origin);
    expect(worker().posted).toHaveLength(1);
    worker().respond();
    await active;
    expect(worker().posted).toHaveLength(2);
    expect(worker().posted[1]?.projection).toBeUndefined();
    expect(prepareJobEstimateOffThread(project, origin)).toBe(heldPreview);
    worker().respond('preview');
    await expect(heldEstimate).resolves.toEqual({ toolpath, estimate });
    await expect(heldPreview).resolves.toEqual({ toolpath, estimate });
    expect(worker().posted).toHaveLength(2);
  });

  it('joins a held full Preview without cancelling it when ETA asks for the same options', async () => {
    const project = createProject();
    const active = prepareJobEstimateOffThread(project);
    const held = prepareLargeJobOffThread(project, origin);
    expect(prepareJobEstimateOffThread(project, origin)).toBe(held);
    worker().respond();
    await active;
    worker().respond('preview');
    await expect(held).resolves.toEqual({ toolpath, estimate });
  });

  it('keeps settled estimate reuse within the four-entry LRU bound', async () => {
    const project = createProject();
    const anchors = ['front-left', 'front-center', 'front-right', 'center-left', 'center'] as const;
    expect(anchors).toHaveLength(MAX_SETTLED_PREPARATIONS + 1);
    for (const anchor of anchors) {
      const options = { jobOrigin: { startFrom: 'user-origin' as const, anchor } };
      const pending = prepareJobEstimateOffThread(project, options);
      worker().respond();
      await pending;
    }
    expect(worker().posted).toHaveLength(5);
    const evicted = prepareJobEstimateOffThread(project, {
      jobOrigin: { startFrom: 'user-origin', anchor: anchors[0] },
    });
    expect(worker().posted).toHaveLength(6);
    worker().respond();
    await evicted;
  });

  it('terminates stale estimate work and rejects both capabilities when the project changes', async () => {
    vi.useFakeTimers();
    const project = createProject();
    const active = prepareJobEstimateOffThread(project);
    const heldEstimate = prepareJobEstimateOffThread(project, origin);
    const heldPreview = prepareLargeJobOffThread(project, origin);
    const staleWorker = worker();
    const next = prepareJobEstimateOffThread(createProject());
    await expect(active).rejects.toThrow('superseded by a newer project');
    await expect(heldEstimate).rejects.toThrow('superseded by a newer project');
    await expect(heldPreview).rejects.toThrow('superseded by a newer project');
    expect(staleWorker.terminated).toBe(true);
    expect(worker().posted).toHaveLength(0);
    vi.advanceTimersByTime(SUPERSEDE_QUIET_WINDOW_MS);
    worker().respond();
    await expect(next).resolves.toEqual({ estimate });
  });

  it('retries a real estimate failure instead of retaining the rejected entry', async () => {
    const project = createProject();
    const failed = prepareJobEstimateOffThread(project);
    worker().send({ id: worker().posted[0]?.id ?? -1, kind: 'error', message: 'compile failed' });
    await expect(failed).rejects.toThrow('compile failed');
    const retry = prepareJobEstimateOffThread(project);
    expect(retry).not.toBe(failed);
    worker().respond();
    await expect(retry).resolves.toEqual({ estimate });
  });

  it('rejects an estimate-only response to a full Preview request', async () => {
    const full = prepareLargeJobOffThread(createProject());
    worker().respond();
    await expect(full).rejects.toThrow('omitted the requested preview');
  });

  it('preserves the full Preview placement carrier through estimate promotion and cached reuse', async () => {
    const project = createProject();
    const active = prepareJobEstimateOffThread(project);
    const heldEstimate = prepareJobEstimateOffThread(project, origin);
    const heldPreview = prepareLargeJobOffThread(project, origin);
    worker().respond();
    await active;
    const jobOriginOffset = { x: -37.25, y: 18.5 };
    worker().send({
      id: worker().posted.at(-1)?.id ?? -1,
      kind: 'ok',
      estimate,
      toolpath,
      jobOriginOffset,
    });
    await expect(heldPreview).resolves.toEqual({ estimate, toolpath, jobOriginOffset });
    await expect(heldEstimate).resolves.toEqual({ estimate, toolpath, jobOriginOffset });
    expect(prepareLargeJobOffThread(project, origin)).toBe(heldPreview);
    await expect(prepareLargeJobOffThread(project, origin)).resolves.toHaveProperty(
      'jobOriginOffset',
      jobOriginOffset,
    );
  });
});
