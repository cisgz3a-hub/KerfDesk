import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mixedCanvasCompilationProject } from '../../__fixtures__/mixed-canvas-compilation-project';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import type { JobBounds } from '../../core/job';
import type { Project } from '../../core/scene';
import { createFramedRunPermit, type FramedRunCandidate } from '../state/framed-run';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useCameraStore } from '../state/camera-store';
import { useToastStore } from '../state/toast-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { resetStore } from '../state/test-helpers';
import { isCanvasCompilationBridgeConnection } from '../workspace/canvas-compilation-worker-protocol';
import { idleControllerStatusForFrameTest } from './framed-run-testing';
import { resetOutputPreparationWorkerForTests } from './output-preparation-worker-client';
import { BACKGROUND_OUTPUT_PREPARATION_BUSY_MESSAGE } from './output-preparation-errors';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import type {
  OutputPreparationEnvelope,
  OutputPreparationResponse,
  OutputPreparationResult,
} from './output-preparation-protocol';
import { STALE_START_PREPARATION_MESSAGE } from './start-preparation-owner';
import { runFrameNow } from './use-frame-action';

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent<OutputPreparationResult>) => void) | null = null;
  posted: OutputPreparationEnvelope[] = [];
  terminated = false;
  constructor() {
    ControlledWorker.instances.push(this);
  }
  postMessage(value: unknown): void {
    if (!isCanvasCompilationBridgeConnection(value)) {
      this.posted.push(value as OutputPreparationEnvelope);
    }
  }
  terminate(): void {
    this.terminated = true;
  }
  respond(response: OutputPreparationResponse): void {
    this.onmessage?.({
      data: { requestId: this.posted.at(-1)?.requestId, response },
    } as MessageEvent<OutputPreparationResult>);
  }
  report(progress: OutputCompilationProgress): void {
    this.onmessage?.({
      data: { requestId: this.posted.at(-1)?.requestId, progress },
    } as MessageEvent<OutputPreparationResult>);
  }
}

// The controlled worker holds every compilation open until a test answers it,
// so the job's size never stands in for a slow compile. finishCompilation still
// compiles for real on the test thread: one engraved CNC mark takes
// milliseconds, where the mixed fixture's V-carve load took about a second per
// Frame and pushed repeated Frames past the 5 s test timeout.
function engravedMarkProject(): Project {
  const project = mixedCanvasCompilationProject();
  const objects = project.scene.objects.filter((object) => object.id === 'engraved-mark');
  return { ...project, scene: { ...project.scene, objects } };
}

const originalFrame = useLaserStore.getState().frame;
const latest = () => ControlledWorker.instances.at(-1)!;
const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);

function installMockFrame(): () => void {
  let dispatchedCandidate: FramedRunCandidate | undefined;
  useLaserStore.setState({
    frame: vi.fn(async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
      if (candidate === undefined) throw new Error('Missing test Frame candidate');
      dispatchedCandidate = candidate;
      useLaserStore.setState({
        statusReport: { ...idleControllerStatusForFrameTest(), state: 'Jog' },
        motionOperation: {
          operationId: 1,
          kind: 'frame',
          candidate,
          sawControllerBusy: true,
          idleStatusReports: 0,
          dispatchComplete: true,
          pendingLines: [],
        },
      });
    }),
  });
  return () => {
    const candidate = dispatchedCandidate;
    if (candidate === undefined) throw new Error('Test Frame was not dispatched');
    useLaserStore.setState({ statusReport: idleControllerStatusForFrameTest() });
    useLaserStore.setState((laser) => ({
      motionOperation: null,
      framedRun: createFramedRunPermit(candidate, laser),
      frameVerification: candidate.frameVerification,
    }));
    dispatchedCandidate = undefined;
  };
}

async function finishCompilation(worker: ControlledWorker): Promise<void> {
  const response = await prepareOutputRequestForTest(worker.posted.at(-1)!.request);
  expect(response).toMatchObject({ kind: 'start', result: { ok: true } });
  worker.respond(response);
  await vi.waitFor(() => expect(useLaserStore.getState().motionOperation?.kind).toBe('frame'));
}

beforeEach(() => {
  resetStore();
  resetOutputPreparationWorkerForTests();
  useExperimentalLaserFeatures.getState().resetFeatures();
  usePrintCutSessionStore.getState().clear();
  ControlledWorker.instances = [];
  vi.stubGlobal('Worker', ControlledWorker);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  useStore.setState({ project: engravedMarkProject() });
  useLaserStore.setState({
    ...initialLaserState(),
    statusReport: idleControllerStatusForFrameTest(),
    activeWcs: 'G54',
    workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 0 },
    frame: vi.fn(async () => undefined),
  });
  useToastStore.setState({ toasts: [] });
  useCameraStore.setState({ placementActive: false, confirmedPositionEpoch: null });
});

afterEach(() => {
  resetOutputPreparationWorkerForTests();
  useLaserStore.setState({ frame: originalFrame });
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Frame preparation ownership', () => {
  it('shares one compilation and Frame across repeated calls, then allows a completed Frame retry', async () => {
    const completeFrame = installMockFrame();
    const first = runFrameNow();
    expect(useFramePreparationStore.getState().pending).toBe(true);
    const second = runFrameNow();
    const third = runFrameNow();
    expect(second).toBe(first);
    expect(third).toBe(first);
    await vi.waitFor(() => expect(latest()?.posted).toHaveLength(1));
    const worker = latest();
    expect(worker.posted).toHaveLength(1);
    expect(useLaserStore.getState().motionOperation).toBeNull();
    await finishCompilation(worker);
    expect(runFrameNow()).toBe(first);
    expect(useFramePreparationStore.getState().pending).toBe(true);
    completeFrame();
    await expect(Promise.all([first, second, third])).resolves.toEqual([true, true, true]);
    expect(useFramePreparationStore.getState().pending).toBe(false);
    expect(worker.posted).toHaveLength(1);
    expect(worker.terminated).toBe(false);
    expect(toasts()).not.toContain(BACKGROUND_OUTPUT_PREPARATION_BUSY_MESSAGE);
    expect(toasts()).not.toContain(STALE_START_PREPARATION_MESSAGE);
    expect(useLaserStore.getState().frame).toHaveBeenCalledTimes(1);

    const retry = runFrameNow();
    expect(retry).not.toBe(first);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(2));
    await finishCompilation(worker);
    completeFrame();
    await expect(retry).resolves.toBe(true);
    expect(useFramePreparationStore.getState().pending).toBe(false);
    expect(worker.posted).toHaveLength(2);
    expect(useLaserStore.getState().frame).toHaveBeenCalledTimes(2);
  });

  it('releases failed compilation ownership so a new Frame can prepare and succeed', async () => {
    const completeFrame = installMockFrame();
    const first = runFrameNow();
    const duplicate = runFrameNow();
    expect(duplicate).toBe(first);
    await vi.waitFor(() => expect(latest()?.posted).toHaveLength(1));
    const worker = latest();
    worker.respond({ kind: 'error', message: 'Test compiler failed' });
    await expect(Promise.all([first, duplicate])).resolves.toEqual([false, false]);
    expect(useFramePreparationStore.getState().pending).toBe(false);
    expect(toasts().filter((message) => message === 'Test compiler failed')).toHaveLength(1);
    expect(useLaserStore.getState().frame).not.toHaveBeenCalled();

    const retry = runFrameNow();
    expect(retry).not.toBe(first);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(2));
    await finishCompilation(worker);
    completeFrame();
    await expect(retry).resolves.toBe(true);
    expect(useFramePreparationStore.getState().pending).toBe(false);
    expect(worker.terminated).toBe(false);
    expect(useLaserStore.getState().frame).toHaveBeenCalledTimes(1);
  });

  it('releases stale compilation ownership and retries against the current edited job', async () => {
    const completeFrame = installMockFrame();
    const first = runFrameNow();
    const duplicate = runFrameNow();
    expect(duplicate).toBe(first);
    await vi.waitFor(() => expect(latest()?.posted).toHaveLength(1));
    const retiredWorker = latest();
    useStore.setState((app) => ({
      project: {
        ...app.project,
        scene: {
          ...app.project.scene,
          layers: app.project.scene.layers.map((layer) => ({
            ...layer,
            cnc: { ...layer.cnc!, depthMm: 3 },
          })),
        },
      },
    }));
    await expect(Promise.all([first, duplicate])).resolves.toEqual([false, false]);
    expect(useFramePreparationStore.getState().pending).toBe(false);
    expect(retiredWorker.terminated).toBe(true);
    expect(toasts().filter((message) => message === STALE_START_PREPARATION_MESSAGE)).toHaveLength(
      1,
    );
    expect(useLaserStore.getState().frame).not.toHaveBeenCalled();

    const retry = runFrameNow();
    expect(retry).not.toBe(first);
    expect(useFramePreparationStore.getState().pending).toBe(true);
    await vi.waitFor(() => expect(ControlledWorker.instances).toHaveLength(2));
    const currentWorker = latest();
    await vi.waitFor(() => expect(currentWorker.posted).toHaveLength(1));
    expect(currentWorker.posted[0]!.request.project).toBe(useStore.getState().project);
    await finishCompilation(currentWorker);
    completeFrame();
    await expect(retry).resolves.toBe(true);
    expect(useFramePreparationStore.getState().pending).toBe(false);
    expect(useLaserStore.getState().frame).toHaveBeenCalledTimes(1);
  });

  it("shows the owned compilation's progress and clears it with the Frame", async () => {
    const completeFrame = installMockFrame();
    const first = runFrameNow();
    await vi.waitFor(() => expect(latest()?.posted).toHaveLength(1));
    const worker = latest();
    expect(useFramePreparationStore.getState()).toMatchObject({ pending: true, progress: null });
    const progress: OutputCompilationProgress = {
      phase: 'planning',
      mode: 'parallel',
      completed: 7,
      active: 2,
      queued: 22,
      total: 31,
    };
    worker.report(progress);
    expect(useFramePreparationStore.getState().progress).toEqual(progress);
    await finishCompilation(worker);
    completeFrame();
    await expect(first).resolves.toBe(true);
    expect(useFramePreparationStore.getState()).toEqual({
      pending: false,
      progress: null,
      stage: 'preparing',
      cancellable: false,
    });
    // Nothing owns a Frame now, so a late report has no control to describe.
    worker.report(progress);
    expect(useFramePreparationStore.getState().progress).toBeNull();
  });
});
