import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaserSecondPassSelection } from '../../core/laser-second-pass';
import type { PreparedStartProgram } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository, type ExecutionArtifactV1 } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';
import {
  completeFramedRunCandidateForTest,
  idleControllerStatusForFrameTest,
} from './framed-run-testing';
import { captureJobReviewModels, installAutoJobReview, useJobReviewStore } from './job-review';
import { createSecondPassExecutionFixture } from './second-pass-execution-testing';
import { frameLaserSecondPass, startLaserSecondPass } from './second-pass-execution';
import { registerVerifiedLaserSecondPassPreparation } from './second-pass-preparation-proof';
import type { SecondPassPreview } from './second-pass/second-pass-worker-client';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

type WorkerRequest = {
  readonly id: number;
  readonly source?: ExecutionArtifactV1;
  readonly selection?: LaserSecondPassSelection;
};
type WorkerResponse = { readonly id: number; readonly error?: string; readonly value?: unknown };
const replies = new Map<number, (response: WorkerResponse) => void>();
const worker = {
  onmessage: null as ((event: MessageEvent<WorkerRequest>) => void) | null,
  postMessage: (response: WorkerResponse): void => {
    replies.get(response.id)?.(response);
  },
};
const originalFrame = useLaserStore.getState().frame;
const originalStart = useLaserStore.getState().startJob;
let nextRequestId = 0;
let repository: RecoveryRepository;
let uninstallReview: () => void = () => undefined;

// This runs the actual Worker handler, archive integrity, binding and compiler;
// the message delivery is in-process. Native Chromium Worker qualification is
// recorded separately and this test makes no hardware or optical power claim.
beforeAll(async () => {
  vi.stubGlobal('self', worker);
  await import('./second-pass/second-pass-worker');
});
beforeEach(async () => {
  localStorage.clear();
  resetStore();
  useJobReviewStore.getState().close();
  vi.stubGlobal('self', worker);
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    controllerSessionEpoch: 7,
    controllerQualification: { kind: 'qualified', epoch: 7, settings: 'verified' },
    controllerSettings: { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
    statusReport: idleControllerStatusForFrameTest(),
    activeWcs: 'G54',
    startJob: vi.fn(async (_gcode, options = {}) => {
      options.assertFinalStartAuthorized?.();
    }),
    frame: vi.fn(async (_bounds, _feed, candidate) => {
      if (candidate === undefined) throw new Error('Expected the second-pass Frame candidate.');
      completeFramedRunCandidateForTest(candidate);
    }),
  });
  repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  await repository.initialize();
});
afterEach(() => {
  uninstallReview();
  useJobReviewStore.getState().close();
  replies.clear();
  useLaserStore.setState({ ...initialLaserState(), frame: originalFrame, startJob: originalStart });
  resetStore();
  vi.restoreAllMocks();
});
afterAll(() => vi.unstubAllGlobals());

async function send(request: Omit<WorkerRequest, 'id'>): Promise<unknown> {
  const id = ++nextRequestId;
  const response = await new Promise<WorkerResponse>((resolve) => {
    replies.set(id, resolve);
    if (worker.onmessage === null) throw new Error('The actual source Worker was not loaded.');
    worker.onmessage(new MessageEvent('message', { data: { ...request, id } }));
  });
  replies.delete(id);
  if (response.error !== undefined) throw new Error(response.error);
  return response.value;
}

async function workerFixture(): Promise<PreparedStartProgram> {
  const fixture = await createSecondPassExecutionFixture(repository);
  expect(fixture.prepared.laserPowerScale).toBeUndefined();
  await send({ source: fixture.source });
  const preview = (await send({ selection: fixture.selection })) as SecondPassPreview;
  expect(preview.prepared.laserPowerScale).toBeUndefined();
  expect(preview.prepared.gcode).toBe(fixture.prepared.gcode);
  registerVerifiedLaserSecondPassPreparation(fixture.source, preview.prepared, fixture.selection);
  const permit = await frameLaserSecondPass(fixture.source, preview.prepared, fixture.selection);
  if (permit === null) throw new Error('Expected the exact second-pass Frame.');
  return permit.candidate.preparedStart;
}

function observeMax(maxPowerS: number): void {
  useLaserStore.setState((state) => ({
    controllerSettings: { ...state.controllerSettings, maxPowerS },
    controllerSettingsObservation: { sessionEpoch: state.controllerSessionEpoch, observedAt: 2 },
  }));
}

function currentPermit() {
  const permit = useLaserStore.getState().framedRun;
  if (permit === null) throw new Error('Expected the retained second-pass Frame.');
  return permit;
}

function expectOriginalBytes(prepared: PreparedStartProgram): void {
  expect(useLaserStore.getState().startJob).toHaveBeenCalledOnce();
  expect(vi.mocked(useLaserStore.getState().startJob).mock.calls[0]?.[0]).toBe(prepared.gcode);
  const artifact = repository.getSnapshot().activeRun?.artifact;
  if (artifact?.kind !== 'exact-execution') throw new Error('Expected the accepted exact archive.');
  expect(artifact.gcode).toBe(prepared.gcode);
  expect(artifact.prepared.project.device.maxPowerS).toBe(1000);
  expect(useLaserStore.getState().frame).toHaveBeenCalledOnce();
}

describe('frozen source-worker second-pass power disclosure', () => {
  it('keeps original bytes and Frame while disclosing a changed current range at Start', async () => {
    const prepared = await workerFixture();
    const permit = currentPermit();
    observeMax(255);
    uninstallReview = installAutoJobReview('confirm');
    const capture = captureJobReviewModels();
    try {
      await expect(startLaserSecondPass(permit, repository)).resolves.toBe(true);
      expect(capture.models.at(-1)?.warnings.join('\n')).toContain('original S1000 scale');
      expect(capture.models.at(-1)?.warnings.join('\n')).toContain('$30=255');
      expectOriginalBytes(prepared);
    } finally {
      capture.stop();
    }
  });

  it.each([
    { initial: 1000, changed: 255, warning: true },
    { initial: 255, changed: 1000, warning: false },
  ])(
    'redisplays current range $changed and needs a second Confirm after range $initial changes',
    async ({ initial, changed, warning }) => {
      const prepared = await workerFixture();
      const permit = currentPermit();
      observeMax(initial);
      const capture = captureJobReviewModels();
      const starting = startLaserSecondPass(permit, repository);
      try {
        await vi.waitFor(() => expect(capture.models).toHaveLength(1));
        const initialWarnings = capture.models[0]?.warnings.join('\n') ?? '';
        expect(initialWarnings.includes('original S1000 scale')).toBe(initial !== 1000);
        observeMax(changed);
        useJobReviewStore.getState().confirm();
        await vi.waitFor(() => expect(capture.models).toHaveLength(2));
        const revisedWarnings = capture.models[1]?.warnings.join('\n') ?? '';
        expect(revisedWarnings.includes('original S1000 scale')).toBe(warning);
        expect(revisedWarnings.includes('$30=255')).toBe(warning);
        expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
        expect(useLaserStore.getState().framedRun).toBe(permit);
        useJobReviewStore.getState().confirm();
        await expect(starting).resolves.toBe(true);
        expectOriginalBytes(prepared);
      } finally {
        capture.stop();
        useJobReviewStore.getState().cancel();
        await starting;
      }
    },
  );
});
