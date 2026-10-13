import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE, createProject } from '../../core/scene';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import type { IdleCanvasMotionPlanRequest } from './idle-canvas-motion-plan';
import {
  isIdleCanvasMotionSuperseded,
  prepareIdleCanvasMotionPlanOffThread,
  resetIdleCanvasMotionWorkerForTests,
} from './idle-canvas-motion-worker-client';
import { isCanvasCompilationBridgeConnection } from './canvas-compilation-worker-protocol';
import type { IdleCanvasMotionWorkerRequest } from './idle-canvas-motion-worker-protocol';
import { buildCanvasMarkerPlan, type CanvasMotionPlan } from '../state/canvas-motion-plan';
import { loadCanvasStartBounds } from '../state/canvas-start-bounds-loader';
import { prepareOutput } from '../../io/gcode';

type Posted = IdleCanvasMotionWorkerRequest;

class FakeWorker {
  static instances: FakeWorker[] = [];
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onmessageerror: (() => void) | null = null;
  public readonly posted: Posted[] = [];
  public terminated = false;
  public bridgeConnected = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    if (isCanvasCompilationBridgeConnection(message)) {
      this.bridgeConnected = true;
      return;
    }
    this.posted.push(message as Posted);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(id: number, plan: CanvasMotionPlan | null = null): void {
    this.onmessage?.({ data: { id, kind: 'ok', plan } } as MessageEvent);
  }

  failToCloneResponse(): void {
    this.onmessageerror?.();
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

function latestWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error('Expected worker');
  return worker;
}

function firstRequest(worker: FakeWorker): Posted {
  const request = worker.posted[0];
  if (request === undefined) throw new Error('Expected request');
  return request;
}

afterEach(() => {
  resetIdleCanvasMotionWorkerForTests();
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

describe('idle canvas motion worker client', () => {
  it('loads defaults bounds only on demand with the exact frozen worker request', async () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
    const project = { ...REQUEST.project, startPoints: { job: { x: 10, y: 20 } } };
    const prepared = prepareOutput(project);
    if (!prepared.ok) throw new Error('Expected prepared output');
    const plan = buildCanvasMarkerPlan({ prepared, machine: REQUEST.machine });
    const pending = prepareIdleCanvasMotionPlanOffThread({ ...REQUEST, project });
    const initial = latestWorker();
    const originalRequest = firstRequest(initial);
    initial.reply(originalRequest.id, structuredClone(plan));
    const cloned = await pending;
    if (cloned === null || cloned === undefined) throw new Error('Expected worker plan');
    expect(FakeWorker.instances).toHaveLength(1);
    expect(originalRequest.request.evaluatedAtIso).toEqual(expect.any(String));
    expect(cloned.startEditingData?.bounds).toBeUndefined();
    const bounds = loadCanvasStartBounds(cloned);
    const requested = latestWorker();
    const boundsRequest = firstRequest(requested);
    expect(boundsRequest.request).toEqual({
      ...originalRequest.request,
      includeStartPointBounds: true,
    });
    const value = { minX: 1, minY: 2, maxX: 30, maxY: 40 };
    requested.reply(boundsRequest.id, {
      ...plan,
      startEditingData: {
        job: { groups: [] },
        jobReason: null,
        jobOriginOffset: { x: 0, y: 0 },
        bounds: value,
      },
    });
    await expect(bounds).resolves.toEqual(value);
    expect(initial.terminated).toBe(true);
    expect(requested.terminated).toBe(true);
  });

  it('returns null when Worker support is unavailable', () => {
    vi.stubGlobal('Worker', undefined);
    expect(prepareIdleCanvasMotionPlanOffThread(REQUEST)).toBeNull();
  });

  it('terminates stale V-carve preparation instead of queueing it behind the newest edit', async () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
    const first = prepareIdleCanvasMotionPlanOffThread(REQUEST);
    expect(first).not.toBeNull();
    const firstWorker = FakeWorker.instances[0];
    expect(firstWorker?.bridgeConnected).toBe(true);

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

  it('rejects and retires a worker whose response cannot be cloned', async () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
    const pending = prepareIdleCanvasMotionPlanOffThread(REQUEST);
    const worker = FakeWorker.instances[0];

    worker?.failToCloneResponse();

    await expect(pending).rejects.toThrow('response was not cloneable');
    expect(worker?.terminated).toBe(true);
  });
});
