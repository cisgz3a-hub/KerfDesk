import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mixedCanvasCompilationProject } from '../../__fixtures__/mixed-canvas-compilation-project';
import { createProject } from '../../core/scene';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useCameraStore } from '../state/camera-store';
import { useToastStore } from '../state/toast-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { resetStore } from '../state/test-helpers';
import { isCanvasCompilationBridgeConnection } from '../workspace/canvas-compilation-worker-protocol';
import { idleControllerStatusForFrameTest } from './framed-run-testing';
import {
  prepareSaveOutputOffThread,
  resetOutputPreparationWorkerForTests,
} from './output-preparation-worker-client';
import type {
  OutputPreparationEnvelope,
  OutputPreparationResponse,
  OutputPreparationResult,
} from './output-preparation-protocol';
import { prepareCurrentStartJob } from './start-job-source';
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
}

const originalFrame = useLaserStore.getState().frame;
const latest = () => ControlledWorker.instances.at(-1)!;
const saved = (gcode: string): OutputPreparationResponse => ({
  kind: 'save',
  result: {
    kind: 'emitted',
    gcode,
    preflight: { ok: true, issues: [] },
    cncVCarveDepths: [],
  },
});
const save = () =>
  prepareSaveOutputOffThread({
    kind: 'save',
    project: createProject(),
    options: {},
  })!;
const start = (signal?: AbortSignal) =>
  prepareCurrentStartJob(
    useStore.getState(),
    useLaserStore.getState(),
    useCameraStore.getState(),
    undefined,
    false,
    signal,
  );
const editOutput = () =>
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

beforeEach(() => {
  resetStore();
  resetOutputPreparationWorkerForTests();
  useExperimentalLaserFeatures.getState().resetFeatures();
  usePrintCutSessionStore.getState().clear();
  ControlledWorker.instances = [];
  vi.stubGlobal('Worker', ControlledWorker);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  useStore.setState({ project: mixedCanvasCompilationProject() });
  useLaserStore.setState({
    ...initialLaserState(),
    statusReport: idleControllerStatusForFrameTest(),
    activeWcs: 'G54',
    workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 0 },
    frame: vi.fn(async () => undefined),
  });
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

describe('R1: current Frame/Start preparation owns its worker lifetime', () => {
  it('cancels a stale active Frame, dispatches the queued Save, and issues no Frame permit', async () => {
    const frame = runFrameNow();
    await vi.waitFor(() => expect(latest()?.posted[0]?.request.kind).toBe('start'));
    const oldWorker = latest();
    const queued = save();
    editOutput();
    await expect(frame).resolves.toBe(false);
    expect(oldWorker.terminated).toBe(true);
    expect(latest()).not.toBe(oldWorker);
    expect(latest().posted[0]?.request.kind).toBe('save');
    expect(useLaserStore.getState().frame).not.toHaveBeenCalled();
    expect(useLaserStore.getState().framedRun).toBeNull();
    latest().respond(saved('QUEUED SAVE'));
    await expect(queued).resolves.toMatchObject({ gcode: 'QUEUED SAVE' });
    expect(
      useToastStore
        .getState()
        .toasts.some((toast) => toast.message === STALE_START_PREPARATION_MESSAGE),
    ).toBe(true);
  });

  it('removes only a stale queued Start and allows an explicit retry after Save', async () => {
    const active = save();
    const worker = latest();
    const queued = start();
    editOutput();
    await expect(queued).resolves.toEqual({
      ok: false,
      messages: [STALE_START_PREPARATION_MESSAGE],
    });
    expect(worker.terminated).toBe(false);
    const retry = start();
    worker.respond(saved('ACTIVE SAVE'));
    await expect(active).resolves.toMatchObject({ gcode: 'ACTIVE SAVE' });
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1]?.request.kind).toBe('start');
    worker.respond({ kind: 'start', result: { ok: false, messages: ['current job result'] } });
    await expect(retry).resolves.toEqual({ ok: false, messages: ['current job result'] });
    expect(ControlledWorker.instances).toHaveLength(1);
  });

  it('preserves healthy preparation across advisory settings and UI-only changes', async () => {
    const pending = start();
    const worker = latest();
    useLaserStore.setState({ controllerSettings: { laserModeEnabled: true } });
    useStore.setState({ previewMode: true });
    expect(worker.terminated).toBe(false);
    worker.respond({ kind: 'start', result: { ok: false, messages: ['prepared'] } });
    await expect(pending).resolves.toEqual({ ok: false, messages: ['prepared'] });
    // Settled owners detach: a later source change cannot retire a new Save.
    const next = save();
    editOutput();
    expect(worker.terminated).toBe(false);
    worker.respond(saved('AFTER SETTLEMENT'));
    await expect(next).resolves.toMatchObject({ gcode: 'AFTER SETTLEMENT' });
  });

  it('cancels on a controller session change without touching another queued owner', async () => {
    const pending = start();
    const worker = latest();
    const queued = save();
    useLaserStore.setState((laser) => ({
      controllerSessionEpoch: laser.controllerSessionEpoch + 1,
    }));
    await expect(pending).resolves.toEqual({
      ok: false,
      messages: [STALE_START_PREPARATION_MESSAGE],
    });
    expect(worker.terminated).toBe(true);
    latest().respond(saved('NEW SESSION SAVE'));
    await expect(queued).resolves.toMatchObject({ gcode: 'NEW SESSION SAVE' });
  });

  it('keeps caller cancellation as AbortError and rejects an already-stale captured source', async () => {
    const controller = new AbortController();
    const pending = start(controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    const captured = useStore.getState();
    editOutput();
    await expect(
      prepareCurrentStartJob(
        captured,
        useLaserStore.getState(),
        useCameraStore.getState(),
        undefined,
        false,
      ),
    ).resolves.toEqual({ ok: false, messages: [STALE_START_PREPARATION_MESSAGE] });
    expect(ControlledWorker.instances).toHaveLength(1);
  });
});
