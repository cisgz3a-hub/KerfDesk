// ADR-237 integration tests through the REAL Job Review gate: a
// review-pending permit opens the single review at Start (purpose 'start'),
// cancel keeps the permit armed, birth-reviewed permits stream without
// reopening the dialog, and a permit that dies mid-review streams nothing.
// The mocked-gate seam tests live in start-job-review-at-start.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
  type LegacyCheckpointStorage,
} from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { FRAMED_PERMIT_LOST_DURING_REVIEW_MESSAGE } from './framed-run-start-review';
import {
  installFramedRunPermitForCurrentState,
  installReviewPendingFramedRunPermitForCurrentState,
} from './framed-run-testing';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const CONTROLLER_EPOCH = 7;
let uninstallAutoReview: () => void = () => undefined;

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

const lineObject: SceneObject = {
  kind: 'imported-svg',
  id: 'line-object',
  source: 'line.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 1, y: 1 },
            { x: 9, y: 9 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function runnableProject() {
  return {
    ...createProject({
      ...DEFAULT_DEVICE_PROFILE,
      streamingMode: 'ping-pong' as const,
      rxBufferBytes: 96,
    }),
    scene: {
      ...EMPTY_SCENE,
      objects: [lineObject],
      layers: [createLayer({ id: 'red', color: '#ff0000' })],
    },
  };
}

function testRepository(): RecoveryRepository {
  const legacyStorage: LegacyCheckpointStorage = {
    read: () => null,
    clear: () => undefined,
  };
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage,
    nowIso: () => '2026-07-21T12:00:00.000Z',
  });
}

function startSpy() {
  return vi.mocked(useLaserStore.getState().startJob);
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  useStore.setState({
    project: runnableProject(),
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idleStatus,
    controllerSessionEpoch: CONTROLLER_EPOCH,
    controllerQualification: {
      kind: 'qualified',
      epoch: CONTROLLER_EPOCH,
      settings: 'verified',
    },
    controllerSettings: {
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
      laserModeEnabled: DEFAULT_DEVICE_PROFILE.laserModeEnabled,
    },
    controllerSettingsObservation: { sessionEpoch: CONTROLLER_EPOCH, observedAt: 1 },
    startJob: vi.fn(async () => undefined),
  });
  useToastStore.setState({ toasts: [] });
  useJobReviewStore.getState().close();
  uninstallAutoReview = installAutoJobReview('confirm');
});

afterEach(() => {
  uninstallAutoReview();
  useJobReviewStore.getState().close();
  localStorage.clear();
  useLaserStore.setState({
    ...initialLaserState(),
    startJob: originalStartJob,
  });
  vi.restoreAllMocks();
});

describe('ADR-237 Start-time Job Review', () => {
  it('opens the single Job Review at Start for a review-pending permit and streams on confirm', async () => {
    const permit = await installReviewPendingFramedRunPermitForCurrentState();
    expect(permit.candidate.review).toBeUndefined();
    let openedPurpose: string | null = null;
    const stopObserving = useJobReviewStore.subscribe((store) => {
      if (store.state.kind === 'open') openedPurpose = store.state.purpose;
    });

    try {
      await runStartJobFlow(testRepository());
    } finally {
      stopObserving();
    }

    expect(openedPurpose).toBe('start');
    expect(startSpy()).toHaveBeenCalledWith(
      permit.candidate.preparedStart.gcode,
      expect.objectContaining({
        machineKind: 'laser',
        laserModeStartEvidence: expect.objectContaining({
          controllerSessionEpoch: CONTROLLER_EPOCH,
        }),
      }),
    );
  });

  it('cancelling the Start review streams nothing and keeps the permit armed', async () => {
    uninstallAutoReview();
    uninstallAutoReview = installAutoJobReview('cancel');
    const permit = await installReviewPendingFramedRunPermitForCurrentState();

    await runStartJobFlow(testRepository());

    expect(startSpy()).not.toHaveBeenCalled();
    expect(useLaserStore.getState().framedRun).toBe(permit);
  });

  it('streams a birth-reviewed permit without reopening Job Review', async () => {
    await installFramedRunPermitForCurrentState();
    let reviewOpened = false;
    const stopObserving = useJobReviewStore.subscribe((store) => {
      if (store.state.kind === 'open') reviewOpened = true;
    });

    try {
      await runStartJobFlow(testRepository());
    } finally {
      stopObserving();
    }

    expect(reviewOpened).toBe(false);
    expect(startSpy()).toHaveBeenCalledTimes(1);
  });

  it('streams nothing when the permit dies while the Start review is open', async () => {
    uninstallAutoReview();
    uninstallAutoReview = installAutoJobReview(() => {
      useLaserStore.setState({ framedRun: null, frameVerification: null });
      return 'confirm';
    });
    await installReviewPendingFramedRunPermitForCurrentState();

    await runStartJobFlow(testRepository());

    expect(startSpy()).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      FRAMED_PERMIT_LOST_DURING_REVIEW_MESSAGE,
    );
  });
});
