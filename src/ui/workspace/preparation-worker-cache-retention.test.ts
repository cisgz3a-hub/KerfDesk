import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { isCanvasCompilationBridgeConnection } from './canvas-compilation-worker-protocol';
import {
  prepareJobEstimateOffThread,
  prepareLargeJobOffThread,
  resetPreparationWorkerForTests,
} from './preparation-worker-client';
import type {
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<PreparationWorkerResponse>) => void) | null = null;
  requests: PreparationWorkerRequest[] = [];
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(data: unknown): void {
    if (!isCanvasCompilationBridgeConnection(data))
      this.requests.push(data as PreparationWorkerRequest);
  }
  terminate(): void {
    // The fake owns no worker resources to release.
  }
  respond(): void {
    const request = this.requests.at(-1);
    if (request === undefined) throw new Error('missing request');
    const data: PreparationWorkerResponse =
      request.projection === 'estimate'
        ? { id: request.id, kind: 'estimate', estimate: result.estimate }
        : { id: request.id, kind: 'ok', ...result };
    this.onmessage?.({ data } as MessageEvent<PreparationWorkerResponse>);
  }
}

const result = { toolpath: { steps: [], totalLength: 1 }, estimate: { kind: 'empty' as const } };
const shifted = { jobOrigin: { startFrom: 'user-origin' as const, anchor: 'center' as const } };
function worker(): FakeWorker {
  const found = FakeWorker.instances.at(-1);
  if (found === undefined) throw new Error('missing worker');
  return found;
}
function requests(): PreparationWorkerRequest[] {
  return FakeWorker.instances.flatMap((instance) => instance.requests);
}
beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  resetPreparationWorkerForTests();
  vi.unstubAllGlobals();
});

describe('Preview request retention', () => {
  it('releases the previous cached route before its replacement returns', async () => {
    const project = createProject();
    const first = prepareLargeJobOffThread(project);
    worker().respond();
    await expect(first).resolves.toEqual(result);
    const replacement = prepareLargeJobOffThread(project, shifted);
    expect(prepareLargeJobOffThread(project, shifted)).toBe(replacement);
    const revisited = prepareLargeJobOffThread(project);
    expect(revisited).not.toBe(first);
    expect(requests()).toHaveLength(2);
    worker().respond();
    await expect(replacement).resolves.toEqual(result);
    expect(requests()).toHaveLength(3);
    worker().respond();
    await expect(revisited).resolves.toEqual(result);
    expect(prepareLargeJobOffThread(project)).toBe(revisited);
    expect(prepareJobEstimateOffThread(project)).toBe(revisited);
  });

  it('delivers an older active result without making it reusable while a new Preview waits', async () => {
    const project = createProject();
    const earlier = prepareLargeJobOffThread(project);
    const latest = prepareLargeJobOffThread(project, shifted);
    expect(prepareJobEstimateOffThread(project)).toBe(earlier);
    worker().respond();
    await expect(earlier).resolves.toEqual(result);
    expect(requests()).toHaveLength(2);
    const freshEstimate = prepareJobEstimateOffThread(project);
    expect(freshEstimate).not.toBe(earlier);
    expect(prepareLargeJobOffThread(project, shifted)).toBe(latest);
    worker().respond();
    await expect(latest).resolves.toEqual(result);
    expect(requests()).toHaveLength(3);
    expect(worker().requests[0]?.projection).toBe('estimate');
    worker().respond();
    await expect(freshEstimate).resolves.toEqual({ estimate: result.estimate });
    expect(prepareJobEstimateOffThread(project, shifted)).toBe(latest);
  });
});
