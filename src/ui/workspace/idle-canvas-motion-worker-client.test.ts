import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE, createProject } from '../../core/scene';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import type { IdleCanvasMotionPlanRequest } from './idle-canvas-motion-plan';
import {
  isIdleCanvasMotionSuperseded,
  prepareIdleCanvasMotionPlanOffThread,
  resetIdleCanvasMotionWorkerForTests,
} from './idle-canvas-motion-worker-client';

type Posted = { readonly id: number };

class FakeWorker {
  static instances: FakeWorker[] = [];
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: (() => void) | null = null;
  public readonly posted: Posted[] = [];
  public terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: Posted): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(id: number): void {
    this.onmessage?.({ data: { id, kind: 'ok', plan: null } } as MessageEvent);
  }
}

const REQUEST: IdleCanvasMotionPlanRequest = {
  project: createProject(),
  outputScope: DEFAULT_OUTPUT_SCOPE,
  placementSettings: DEFAULT_JOB_PLACEMENT,
  resolvedPlacement: { ok: true },
  machine: {
    statusReport: null,
    alarmCode: null,
    hasActiveStreamer: false,
  },
  statusQuery: 'realtime-report',
  reportInches: false,
};

afterEach(() => {
  resetIdleCanvasMotionWorkerForTests();
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

describe('idle canvas motion worker client', () => {
  it('returns null when Worker support is unavailable', () => {
    vi.stubGlobal('Worker', undefined);
    expect(prepareIdleCanvasMotionPlanOffThread(REQUEST)).toBeNull();
  });

  it('terminates stale V-carve preparation instead of queueing it behind the newest edit', async () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
    const first = prepareIdleCanvasMotionPlanOffThread(REQUEST);
    expect(first).not.toBeNull();
    const firstWorker = FakeWorker.instances[0];

    const second = prepareIdleCanvasMotionPlanOffThread({
      ...REQUEST,
      project: { ...REQUEST.project },
    });
    const firstOutcome = await first?.then(
      () => 'resolved',
      (error: unknown) => (isIdleCanvasMotionSuperseded(error) ? 'superseded' : 'failed'),
    );
    expect(firstOutcome).toBe('superseded');
    expect(firstWorker?.terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);

    const newestWorker = FakeWorker.instances[1];
    const newestId = newestWorker?.posted[0]?.id ?? -1;
    newestWorker?.reply(newestId);
    await expect(second).resolves.toBeNull();
  });
});
