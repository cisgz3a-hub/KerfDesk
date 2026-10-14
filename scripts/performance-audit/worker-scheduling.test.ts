import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type ColoredPath } from '../../src/core/scene';
import {
  prepareProjectSaveOffThread,
  type ProjectSavePreparation,
} from '../../src/ui/app/project-save-preparation-client';
import { resetCanvasCompilationMainBridgeForTests } from '../../src/ui/workspace/canvas-compilation-main-bridge';
import { isCanvasCompilationBridgeConnection } from '../../src/ui/workspace/canvas-compilation-worker-protocol';
import {
  prepareJobEstimateOffThread,
  prepareLargeJobOffThread,
  resetPreparationWorkerForTests,
} from '../../src/ui/workspace/preparation-worker-client';
import type {
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from '../../src/ui/workspace/preparation-worker-protocol';
import {
  cancelTracePartWorker,
  prepareTracePartPathOffThread,
  TRACE_PART_WORKER_TIMEOUT_MS,
} from '../../src/ui/workspace/trace-part-worker-client';
import type {
  TracePartWorkerRequest,
  TracePartWorkerResponse,
} from '../../src/ui/workspace/trace-part-worker-protocol';

// These regressions compare scheduling outcomes with the retained audit baseline,
// not wall-clock compute benchmarks. Real client/lane code runs; only
// Worker execution and time are controlled. No compiler or hardware is invoked.
type AuditResponse = PreparationWorkerResponse | ProjectSavePreparation | TracePartWorkerResponse;

class AuditWorker {
  static instances: AuditWorker[] = [];
  static peakLive = 0;
  readonly posted: unknown[] = [];
  readonly filename: string;
  onmessage: ((event: MessageEvent<AuditResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;

  constructor(url: URL) {
    this.filename = url.pathname.split('/').at(-1) ?? '';
    AuditWorker.instances.push(this);
    AuditWorker.peakLive = Math.max(
      AuditWorker.peakLive,
      AuditWorker.instances.filter((worker) => !worker.terminated).length,
    );
  }

  postMessage(message: unknown): void {
    if (isCanvasCompilationBridgeConnection(message)) return;
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(data: AuditResponse): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  preparationRequest(): PreparationWorkerRequest {
    const requests = this.posted.filter(
      (message) => typeof message === 'object' && message !== null && 'project' in message,
    );
    if (this.filename !== 'preparation-worker.ts' || requests.length !== 1) {
      throw new Error('Expected exactly one request to a preparation worker.');
    }
    return requests[0] as PreparationWorkerRequest;
  }
}

const controllers: AbortController[] = [];
const previewResult = {
  toolpath: { steps: [], totalLength: 0 },
  estimate: { kind: 'empty' as const },
};
const simplePath: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    },
  ],
};

function workerAt(index: number, filename: string): AuditWorker {
  const worker = AuditWorker.instances[index];
  if (worker === undefined) throw new Error(`Worker ${index} has not started.`);
  expect(worker.filename).toBe(filename);
  return worker;
}

function pendingState<T>(promise: Promise<T> | null): { settled: boolean } {
  if (promise === null) throw new Error('Expected worker support.');
  const state = { settled: false };
  void promise.then(
    () => {
      state.settled = true;
    },
    () => {
      state.settled = true;
    },
  );
  return state;
}

function finishPreview(worker: AuditWorker): void {
  worker.respond({ id: worker.preparationRequest().id, kind: 'ok', ...previewResult });
}

beforeEach(() => {
  AuditWorker.instances = [];
  AuditWorker.peakLive = 0;
  vi.useFakeTimers();
  vi.stubGlobal('Worker', AuditWorker);
});

afterEach(() => {
  // Cancel queued consumers before releasing their background owner, including
  // when an assertion fails, so no reservation leaks into the next audit case.
  for (const controller of controllers.splice(0)) controller.abort();
  cancelTracePartWorker();
  resetPreparationWorkerForTests();
  resetCanvasCompilationMainBridgeForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('worker scheduling improvements against the audit baseline', () => {
  it('starts manual Save immediately by retiring Preview, then resumes its original consumers', async () => {
    const project = createProject();
    const preview = prepareLargeJobOffThread(project);
    pendingState(preview);
    const background = workerAt(0, 'preparation-worker.ts');
    const controller = new AbortController();
    controllers.push(controller);
    const requestedAt = Date.now();
    const save = prepareProjectSaveOffThread(project, controller.signal);
    const saveState = pendingState(save);

    const saveWorker = workerAt(1, 'project-save-preparation-worker.ts');
    expect(Date.now() - requestedAt).toBe(0);
    expect(background.terminated).toBe(true);
    expect(saveState.settled).toBe(false);
    expect(saveWorker.posted).toHaveLength(1);
    saveWorker.respond({ kind: 'ok', json: '{}' });
    await expect(save).resolves.toEqual({ kind: 'ok', json: '{}' });
    expect(saveWorker.terminated).toBe(true);
    finishPreview(workerAt(2, 'preparation-worker.ts'));
    await expect(preview).resolves.toEqual(previewResult);
    expect(AuditWorker.peakLive).toBe(1);
    console.log(
      JSON.stringify({
        case: 'manual-save-queue',
        baselineBlockedThroughFakeMs: 120_000,
        afterFakeQueueMs: 0,
        peakLiveWorkers: AuditWorker.peakLive,
      }),
    );
  });

  it('starts trace-part editing immediately, keeping the one-heap budget and resuming Preview afterwards', async () => {
    const preview = prepareLargeJobOffThread(createProject());
    pendingState(preview);
    const background = workerAt(0, 'preparation-worker.ts');
    const requestedAt = Date.now();
    const trace = prepareTracePartPathOffThread(simplePath, null);
    const traceState = pendingState(trace);

    const traceWorker = workerAt(1, 'trace-part-worker.ts');
    expect(Date.now() - requestedAt).toBe(0);
    expect(traceState.settled).toBe(false);

    expect(background.terminated).toBe(true);
    expect(traceWorker.posted).toHaveLength(1);
    const request = traceWorker.posted[0] as TracePartWorkerRequest;
    const response: TracePartWorkerResponse = {
      id: request.id,
      kind: 'ok',
      bounds: new Float64Array([0, 0, 1, 1]),
      groups: null,
    };
    traceWorker.respond(response);
    await expect(trace).resolves.toEqual(response);
    cancelTracePartWorker();
    expect(traceWorker.terminated).toBe(true);
    finishPreview(workerAt(2, 'preparation-worker.ts'));
    await expect(preview).resolves.toEqual(previewResult);
    expect(AuditWorker.peakLive).toBe(1);
    console.log(
      JSON.stringify({
        case: 'trace-part-queue',
        baselineBlockedThroughFakeMs: TRACE_PART_WORKER_TIMEOUT_MS * 4,
        afterFakeQueueMs: 0,
        peakLiveWorkers: AuditWorker.peakLive,
      }),
    );
  });

  it('uses one compilation dispatch when Preview joins an active estimate, versus two in the baseline', async () => {
    const project = createProject();
    const estimate = prepareJobEstimateOffThread(project);
    pendingState(estimate);
    const estimateWorker = workerAt(0, 'preparation-worker.ts');
    const first = estimateWorker.preparationRequest();
    expect(first.project).toBe(project);
    expect(first.projection).toBe('estimate');
    const preview = prepareLargeJobOffThread(project);
    const previewState = pendingState(preview);
    expect(AuditWorker.instances).toHaveLength(1);

    estimateWorker.respond({
      id: first.id,
      kind: 'estimate-ready',
      estimate: previewResult.estimate,
    });
    await expect(estimate).resolves.toEqual({ estimate: previewResult.estimate });
    expect(estimateWorker.terminated).toBe(false);
    expect(previewState.settled).toBe(false);
    expect(AuditWorker.instances).toHaveLength(1);
    expect(estimateWorker.posted[1]).toEqual({ id: first.id, kind: 'preview-after-estimate' });
    finishPreview(estimateWorker);
    await expect(preview).resolves.toEqual(previewResult);
    console.log(
      JSON.stringify({
        case: 'active-estimate-preview',
        baselineCompilationDispatches: 2,
        afterCompilationDispatches: 1,
        peakLiveWorkers: AuditWorker.peakLive,
      }),
    );
  });

  it('shares one preparation when Preview starts before the matching estimate (control case)', async () => {
    const project = createProject();
    const preview = prepareLargeJobOffThread(project);
    pendingState(preview);
    const estimate = prepareJobEstimateOffThread(project);
    pendingState(estimate);
    expect(estimate).toBe(preview);
    expect(AuditWorker.instances).toHaveLength(1);
    const background = workerAt(0, 'preparation-worker.ts');
    expect(background.posted).toHaveLength(1);
    finishPreview(background);
    await expect(preview).resolves.toEqual(previewResult);
    await expect(estimate).resolves.toEqual(previewResult);
  });
});
