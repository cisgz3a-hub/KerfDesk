import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { ToolpathStep } from '../../core/job';
import { isCanvasCompilationBridgeConnection } from './canvas-compilation-worker-protocol';
import {
  prepareLargeJobOffThread,
  prepareJobEstimateOffThread,
  resetPreparationWorkerForTests,
  SUPERSEDE_QUIET_WINDOW_MS,
} from './preparation-worker-client';
import type {
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';
import type { PreparationTransferAcknowledgement } from './preparation-transfer-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<PreparationWorkerResponse>) => void) | null = null;
  requests: PreparationWorkerRequest[] = [];
  acknowledgements: PreparationTransferAcknowledgement[] = [];
  terminated = false;
  failAcknowledgement = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(data: PreparationWorkerRequest | PreparationTransferAcknowledgement): void {
    if (isCanvasCompilationBridgeConnection(data)) return;
    if ('kind' in data) {
      if (this.failAcknowledgement) throw new Error('acknowledgement failed');
      this.acknowledgements.push(data);
    } else this.requests.push(data);
  }
  terminate(): void {
    this.terminated = true;
  }
  send(response: PreparationWorkerResponse): void {
    this.onmessage?.(new MessageEvent('message', { data: response }));
  }
  get id(): number {
    return this.requests.at(-1)?.id ?? -1;
  }
  begin(): void {
    this.send({
      id: this.id,
      sequence: 0,
      kind: 'transfer-start',
      header: {
        estimate: { kind: 'empty' },
        jobOriginOffset: { x: 12, y: -8 },
        toolpath: { totalLength: 27 },
        stepCount: 2,
      },
    });
  }
  chunk(offset: number): void {
    this.send({
      id: this.id,
      sequence: offset + 1,
      kind: 'transfer-chunk',
      route: 'legacy',
      offset,
      steps: [step],
    });
  }
}
const step: ToolpathStep = {
  kind: 'travel',
  from: { x: 0, y: 2 },
  to: { x: 4, y: 8 },
  length: 13.5,
  motion: 'feed',
};
const origin = { jobOrigin: { startFrom: 'user-origin' as const, anchor: 'center' as const } };
function worker(): FakeWorker {
  const found = FakeWorker.instances.at(-1);
  if (found === undefined) throw new Error('missing worker');
  return found;
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

describe('full preparation transfer lifecycle', () => {
  it('acknowledges each packet but publishes and caches only a complete route', async () => {
    const project = createProject();
    const pending = prepareLargeJobOffThread(project);
    let settled = false;
    void pending?.then(() => {
      settled = true;
    });
    const current = worker();
    current.begin();
    current.chunk(0);
    current.chunk(1);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(current.acknowledgements.map((ack) => ack.sequence)).toEqual([0, 1, 2]);
    current.send({ id: current.id, sequence: 3, kind: 'transfer-complete' });
    await expect(pending).resolves.toEqual({
      estimate: { kind: 'empty' },
      jobOriginOffset: { x: 12, y: -8 },
      toolpath: { totalLength: 27, steps: [step, step] },
    });
    expect(current.acknowledgements.map((ack) => ack.sequence)).toEqual([0, 1, 2, 3]);
    expect(prepareLargeJobOffThread(project)).toBe(pending);
    expect(prepareJobEstimateOffThread(project)).toBe(pending);
  });

  it('discards partial geometry and ignores late packets when a new project supersedes it', async () => {
    vi.useFakeTimers();
    const stale = prepareLargeJobOffThread(createProject());
    const previous = worker();
    previous.begin();
    previous.chunk(0);
    const fresh = prepareLargeJobOffThread(createProject());
    await expect(stale).rejects.toThrow('superseded by a newer project');
    expect(previous.terminated).toBe(true);
    previous.chunk(1);
    previous.send({ id: previous.id, sequence: 3, kind: 'transfer-complete' });
    expect(previous.acknowledgements).toHaveLength(2);
    vi.advanceTimersByTime(SUPERSEDE_QUIET_WINDOW_MS);
    worker().send({
      id: worker().id,
      kind: 'ok',
      estimate: { kind: 'empty' },
      toolpath: { totalLength: 1, steps: [step] },
    });
    await expect(fresh).resolves.toHaveProperty('toolpath.steps', [step]);
  });

  it('retires the worker and rejects active and queued work for invalid transfer ordering', async () => {
    const project = createProject();
    const active = prepareLargeJobOffThread(project);
    const queued = prepareLargeJobOffThread(project, origin);
    const current = worker();
    current.begin();
    current.chunk(1);
    await expect(active).rejects.toThrow('out-of-order preparation transfer');
    await expect(queued).rejects.toThrow('out-of-order preparation transfer');
    expect(current.terminated).toBe(true);
    const retry = prepareLargeJobOffThread(project);
    worker().send({
      id: worker().id,
      kind: 'ok',
      estimate: { kind: 'empty' },
      toolpath: { steps: [], totalLength: 0 },
    });
    await expect(retry).resolves.toBeDefined();
  });

  it('settles a failed acknowledgement as a real failure instead of waiting forever', async () => {
    const pending = prepareLargeJobOffThread(createProject());
    const current = worker();
    current.failAcknowledgement = true;
    current.begin();
    await expect(pending).rejects.toThrow('acknowledgement failed');
    expect(current.terminated).toBe(true);
  });

  it('drops an interrupted partial transfer before retrying the same project', async () => {
    const project = createProject();
    const pending = prepareLargeJobOffThread(project);
    worker().begin();
    worker().chunk(0);
    worker().send({ id: worker().id, kind: 'error', message: 'transfer failed' });
    await expect(pending).rejects.toThrow('transfer failed');
    const retry = prepareLargeJobOffThread(project);
    worker().begin();
    worker().chunk(0);
    worker().chunk(1);
    worker().send({ id: worker().id, sequence: 3, kind: 'transfer-complete' });
    await expect(retry).resolves.toHaveProperty('toolpath.steps', [step, step]);
  });
});
