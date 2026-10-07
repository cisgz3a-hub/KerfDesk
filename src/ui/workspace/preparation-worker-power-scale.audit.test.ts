import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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

class RequestWorker {
  static instances: RequestWorker[] = [];
  onmessage: ((event: MessageEvent<PreparationWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: PreparationWorkerRequest[] = [];
  terminated = false;

  constructor() {
    RequestWorker.instances.push(this);
  }

  postMessage(data: unknown): void {
    if (!isCanvasCompilationBridgeConnection(data))
      this.posted.push(data as PreparationWorkerRequest);
  }

  terminate(): void {
    this.terminated = true;
  }

  finish(): void {
    this.onmessage?.(
      new MessageEvent<PreparationWorkerResponse>('message', {
        data: {
          id: this.posted[0]?.id ?? -1,
          kind: 'ok',
          toolpath: { steps: [], totalLength: 1 },
          estimate: { kind: 'estimated', label: '1s', totalSeconds: 1 },
        } as unknown as PreparationWorkerResponse,
      }),
    );
  }
}

beforeEach(() => {
  RequestWorker.instances = [];
  vi.stubGlobal('Worker', RequestWorker);
});

afterEach(() => {
  resetPreparationWorkerForTests();
  vi.unstubAllGlobals();
});

it('keys and forwards a changed laser range for the same project, sharing each range with ETA', async () => {
  const project = createProject();
  const lower = prepareLargeJobOffThread(project, { laserMaxPowerS: 255 });
  expect(prepareJobEstimateOffThread(project, { laserMaxPowerS: 255 })).toBe(lower);
  const firstWorker = RequestWorker.instances[0]!;
  expect(firstWorker.posted[0]?.laserMaxPowerS).toBe(255);
  firstWorker.finish();
  await expect(lower).resolves.toBeDefined();

  const higher = prepareLargeJobOffThread(project, { laserMaxPowerS: 1000 });
  expect(higher).not.toBe(lower);
  expect(prepareJobEstimateOffThread(project, { laserMaxPowerS: 1000 })).toBe(higher);
  const secondWorker = RequestWorker.instances[1]!;
  expect(secondWorker.posted[0]?.laserMaxPowerS).toBe(1000);
  expect(secondWorker.posted).toHaveLength(1);
  expect(firstWorker.terminated).toBe(true);
  secondWorker.finish();
  await expect(higher).resolves.toBeDefined();
});
