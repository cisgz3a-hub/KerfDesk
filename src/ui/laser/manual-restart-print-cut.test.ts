// ADR-443 Amendment 2 (rolling audit v4 H2-P1-1): Start from line and Choose
// restart point recompiled a Print-and-Cut job without its registration, so
// the rest of the job burned off the print (5.8 mm in the audit), and ran it
// even where Start refuses. A variable-text job was recompiled with its
// template text, never evaluated. A restart now compiles as Start does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import { createBarcodeObject, defaultBarcodeSpec, type BarcodeShape } from '../../core/barcode';
import { grblDriver } from '../../core/controllers';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  addLayer,
  addObject,
  createArtworkOperation,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { parseVariableTemplateSource } from '../../core/variables';
import { PRINT_CUT_REGISTRATION_INVALID_MESSAGE } from '../../io/gcode/prepare-output-snapshot';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { nativeBedCaptureFrameKey } from '../state/native-bed-frame';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { forgetManualRestartsForTests, prepareManualRestartSource } from './manual-restart-source';
import type * as OutputPreparationWorker from './output-preparation-worker-client';
import { prepareCurrentStartJob } from './start-job-source';
import { forgetTimeBoundStartInputsForTests } from './time-bound-start-inputs';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));
// The off-thread compile Start uses for a time-bound job, run in this thread.
vi.mock('./output-preparation-worker-client', async (importOriginal) => {
  const actual = await importOriginal<typeof OutputPreparationWorker>();
  return {
    ...actual,
    prepareStartOutputOffThread: async (
      request: Parameters<typeof prepareOutputRequestForTest>[0],
    ) => {
      const response = await prepareOutputRequestForTest(request);
      if (response.kind !== 'start') throw new Error('Expected start preparation');
      return actual.hydrateTransferredStartPreparation(response.result);
    },
  };
});

const IDLE: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
};
const ABSOLUTE = { startFrom: 'absolute', anchor: 'front-left' } as const;

/** The audit's 20 × 20 mm square at (40, 40), with design targets on a print. */
function printCutProject(): Project {
  const base = createProject();
  const square = createRectangle({
    id: 'square',
    color: '#0000ff',
    transform: { ...IDENTITY_TRANSFORM, x: 40, y: 40 },
    spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
  });
  const scene = addLayer(addObject(base.scene, square), {
    ...createLayer({ id: 'square', color: '#0000ff' }),
    output: true,
  });
  return {
    ...base,
    scene,
    printAndCutTargets: { first: { x: 0, y: 0 }, second: { x: 100, y: 0 } },
  };
}

/** Captures the two marks the given offset from the design targets. */
function captureMarks(dx: number, dy: number): void {
  const laser = useLaserStore.getState();
  const epoch = laser.trustedPositionEpoch ?? 0;
  const key = nativeBedCaptureFrameKey(useStore.getState().project.device, laser);
  usePrintCutSessionStore.getState().capture('first', { x: dx, y: dy }, epoch, key, 'head');
  usePrintCutSessionStore.getState().capture('second', { x: 100 + dx, y: dy }, epoch, key, 'head');
}

/** What an alarm, reset, reconnect or Home does to the captured marks. */
function retireMarks(): void {
  const laser = useLaserStore.getState();
  useLaserStore.setState({ trustedPositionEpoch: (laser.trustedPositionEpoch ?? 0) + 1 });
}

async function startCompile() {
  const prepared = await prepareCurrentStartJob(
    useStore.getState(),
    useLaserStore.getState(),
    useCameraStore.getState(),
    undefined,
    false,
  );
  if (!prepared.ok) throw new Error(prepared.messages.join('\n'));
  return prepared;
}

function emptyRepository(): RecoveryRepository {
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => new Date().toISOString(),
  });
}

/** Start's compile, run and interrupted: the saved record a restart matches. */
async function interruptedRun(prepared: Awaited<ReturnType<typeof startCompile>>) {
  const laser = useLaserStore.getState();
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'print-cut-run',
    gcode: prepared.gcode,
    prepared: prepared.prepared,
    canvasPlan: prepared.canvasPlan,
    controllerSettings: laser.controllerSettings,
    controllerObservation: { statusReport: laser.statusReport, wco: { x: 0, y: 0, z: 0 } },
    ...(prepared.jobOrigin === undefined ? {} : { jobOrigin: prepared.jobOrigin }),
  });
  const repository = emptyRepository();
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  await repository.activateFreshRun(artifact.runId);
  await repository.interruptRun(artifact.runId, 4, { kind: 'cancelled', message: 'Abort.' });
  return repository;
}

/** The first burn move's X and Y. */
function firstBurn(gcode: string): string | undefined {
  return gcode.split('\n').find((line) => /^G1\b/.test(line) && /X/.test(line));
}

beforeEach(() => {
  forgetManualRestartsForTests();
  forgetTimeBoundStartInputsForTests();
  usePrintCutSessionStore.getState().clear();
  useExperimentalLaserFeatures.getState().setFeature('printAndCut', true);
  useStore.setState({ project: printCutProject(), jobPlacement: ABSOLUTE });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: IDLE,
    capabilities: grblDriver.capabilities,
    controllerSessionEpoch: 9,
    controllerSettings: { maxPowerS: 1_000, minPowerS: 0, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: 9, observedAt: 1 },
    controllerQualification: { kind: 'qualified', epoch: 9, settings: 'verified' },
  });
});

afterEach(() => {
  usePrintCutSessionStore.getState().clear();
  useExperimentalLaserFeatures.getState().setFeature('printAndCut', false);
  useStore.setState({ project: createProject() });
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('a manual restart of a Print-and-Cut job', () => {
  it('registers a restart with no earlier run to the marks captured now, as Start does', async () => {
    captureMarks(5, 3);
    const start = await startCompile();

    const restart = await prepareManualRestartSource(emptyRepository());

    expect(restart?.source.gcode).toBe(start.gcode);
    expect(firstBurn(restart?.source.gcode ?? '')).toContain('X65.000');
    expect(restart?.timeBoundNote).toBe('Print and Cut: registered to the marks captured now.');
  });

  it('refuses with Start’s message when no valid marks exist and no run used any', async () => {
    captureMarks(5, 3);
    retireMarks();

    expect(await prepareManualRestartSource(emptyRepository())).toBeNull();
    expect(vi.mocked(jobAwareAlert).mock.calls.at(-1)?.[0]).toContain(
      PRINT_CUT_REGISTRATION_INVALID_MESSAGE,
    );
  });

  it('replays the interrupted run’s registration after a reset retired its marks', async () => {
    captureMarks(5, 3);
    const start = await startCompile();
    const repository = await interruptedRun(start);
    retireMarks();

    const restart = await prepareManualRestartSource(repository);

    expect(restart?.source.gcode).toBe(start.gcode);
    expect(restart?.programNote).toContain('the program the interrupted job ran');
    expect(restart?.timeBoundNote).toContain('registered to the marks that run used');
  });

  it('takes valid marks captured since, and says how far they move the job', async () => {
    captureMarks(5, 3);
    const start = await startCompile();
    const repository = await interruptedRun(start);
    retireMarks();
    captureMarks(6, 3);

    const restart = await prepareManualRestartSource(repository);

    expect(firstBurn(start.gcode)).toContain('X65.000');
    expect(firstBurn(restart?.source.gcode ?? '')).toContain('X66.000');
    expect(restart?.programNote).toContain('the program the interrupted job ran');
    expect(restart?.timeBoundNote).toContain('up to 1.0 mm');
  });

  it('refuses while Labs has Print and Cut switched off, even with the run’s marks', async () => {
    captureMarks(5, 3);
    const repository = await interruptedRun(await startCompile());
    useExperimentalLaserFeatures.getState().setFeature('printAndCut', false);

    expect(await prepareManualRestartSource(repository)).toBeNull();
    expect(vi.mocked(jobAwareAlert).mock.calls.at(-1)?.[0]).toContain(
      PRINT_CUT_REGISTRATION_INVALID_MESSAGE,
    );
  });
});

/** A variable Data Matrix encoding the moment its job was compiled. */
async function datedProject(): Promise<Project> {
  const source = 'MADE {{datetime}}';
  const parsed = parseVariableTemplateSource(source);
  if (!parsed.ok) throw new Error(parsed.message);
  const spec: BarcodeShape = {
    ...defaultBarcodeSpec('data-matrix'),
    moduleMm: 0.5,
    data: source,
    variableTemplate: parsed.template,
  };
  const created = await createBarcodeObject({
    id: 'dated-code',
    color: '#000000',
    spec,
    value: 'MADE 2026',
    renderCaption: () => Promise.reject(new Error('Data Matrix has no text')),
  });
  if (!created.ok) throw new Error(created.message);
  const project = createProject();
  const bound = createArtworkOperation(project.scene, created.object, { mode: 'fill' });
  return { ...project, scene: addLayer(addObject(project.scene, bound.object), bound.operation) };
}

describe('a manual restart of a variable-text job', () => {
  it('keeps the interrupted run’s clock, so the rest burns the same value', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T09:00:00.000Z'));
    useStore.setState({ project: await datedProject() });
    const start = await startCompile();
    const repository = await interruptedRun(start);
    vi.setSystemTime(new Date('2026-10-27T10:30:00.000Z'));

    const restart = await prepareManualRestartSource(repository);

    expect(restart?.source.gcode).toBe(start.gcode);
    expect(restart?.programNote).toContain('the program the interrupted job ran');
    expect(restart?.timeBoundNote).toBeUndefined();
  });

  it('says the value is evaluated now when no earlier run is reproduced', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T09:00:00.000Z'));
    useStore.setState({ project: await datedProject() });
    const start = await startCompile();
    forgetTimeBoundStartInputsForTests();
    vi.setSystemTime(new Date('2026-10-27T10:30:00.000Z'));

    const restart = await prepareManualRestartSource(emptyRepository());

    // Evaluated, not the template text, and at the restart's own moment.
    expect(restart?.source.gcode).not.toBe(start.gcode);
    expect(restart?.timeBoundNote).toContain('Variable text: evaluated now');
  });
});
