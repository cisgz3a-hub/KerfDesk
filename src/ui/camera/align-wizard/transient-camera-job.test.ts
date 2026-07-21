import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { createProject } from '../../../core/scene';
import {
  createFramedRunPermit,
  framedRunControllerSnapshot,
  type FramedRunCandidate,
  type FramedRunPermit,
} from '../../state/framed-run';
import type { LaserModeStartEvidence } from '../../state/laser-mode-start-evidence';
import { initialLaserState } from '../../state/laser-store-helpers';
import { useLaserStore } from '../../state/laser-store';
import { jobAwareAlert, jobAwareConfirm } from '../../state/job-aware-dialogs';
import { LASER_MODE_UNVERIFIED_START_PROMPT } from '../../laser/laser-mode-start-acknowledgement';
import { prepareStartJobSnapshot, type StartJobPreparation } from '../../laser/start-job-readiness';
import type { ConfirmedJobReview } from '../../laser/job-review';
import {
  dispatchTransientReviewedFrame,
  prepareTransientFrameController,
} from '../../laser/use-frame-action';
import { runTransientCameraJob } from './transient-camera-job';

vi.mock('../../laser/start-job-readiness', () => ({
  prepareStartJobSnapshot: vi.fn(),
}));

vi.mock('../../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

vi.mock('../../laser/job-review', () => ({
  buildJobReviewModel: vi.fn(
    ({
      prepared,
    }: {
      readonly prepared: StartJobPreparation & { readonly warnings: string[] };
    }) => ({
      machineKind: 'laser',
      stats: [],
      warnings: prepared.warnings,
      resolvedOriginLabel: 'Absolute coordinates',
      toolPlanLabels: [],
      acknowledgement: { kind: 'laser-verified' },
      outputQualityFacts: [],
    }),
  ),
}));

vi.mock('../../laser/use-frame-action', () => ({
  dispatchTransientReviewedFrame: vi.fn(),
  prepareTransientFrameController: vi.fn(),
}));

const originalStartJob = useLaserStore.getState().startJob;
const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};
const LASER_MODE_GENERIC_WARNING =
  "The controller's settings dump did not include $32, so laser mode is NOT verified against the firmware. Confirm $32=1 in the controller's configuration before burning.";
const LASER_MODE_DISABLED_WARNING =
  'Controller reports $32=0. Enable GRBL laser mode ($32=1) before starting from KerfDesk.';
const UNRELATED_CAMERA_WARNING = 'Controller $31 minimum S is 5.';

function preparedMarkerJob(warnings: ReadonlyArray<string> = []): StartJobPreparation {
  // The transient flow consumes only these fields; compilation itself is not
  // under test here.
  return {
    ok: true,
    gcode: 'G21\nG90\nM4 S0\nG1 X1 S100\nM5\n',
    warnings,
  } as unknown as StartJobPreparation;
}

function setReadyLaser(
  startJob: typeof originalStartJob,
  laserModeEnabled: boolean | undefined,
): void {
  useLaserStore.setState((state) => ({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idleStatus,
    controllerSessionEpoch: 7,
    controllerSettings: {
      maxPowerS: 1000,
      minPowerS: 0,
      ...(laserModeEnabled === undefined ? {} : { laserModeEnabled }),
    },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 100 },
    capabilities: {
      ...state.capabilities,
      settings: laserModeEnabled === undefined ? 'readonly-dump' : 'grbl-dollar',
    },
    startJob,
  }));
}

function installTransientPermit(review: ConfirmedJobReview): FramedRunPermit {
  const laser = useLaserStore.getState();
  const candidate: FramedRunCandidate = {
    preparedStart: review.bundle.prepared,
    project: review.bundle.project,
    outputScope: {
      cutSelectedGraphics: false,
      useSelectionOrigin: false,
      selectedObjectIds: [],
    },
    executionSignature: 'camera-marker-test',
    frameVerification: {
      boundsSignature: 'camera-marker-test',
      wco: laser.wcoCache,
      workOriginActive: laser.workOriginActive,
    },
    controllerBeforeFrame: framedRunControllerSnapshot(laser),
    externalEnvironment: review.bundle.externalEnvironment,
    returnToWorkPosition: { x: 0, y: 0 },
    review: {
      reviewedAtIso: review.reviewedAtIso,
      reviewModel: review.reviewModel,
      ...(review.laserModeStartEvidence === undefined
        ? {}
        : { laserModeStartEvidence: review.laserModeStartEvidence }),
      ...(review.cncSetupAttestation === undefined
        ? {}
        : { cncSetupAttestation: review.cncSetupAttestation }),
    },
    authorizationContext: 'transient-camera',
  };
  const permit = createFramedRunPermit(candidate, laser);
  useLaserStore.setState({ framedRun: permit, frameVerification: candidate.frameVerification });
  return permit;
}

describe('runTransientCameraJob laser-mode evidence', () => {
  beforeEach(() => {
    vi.mocked(prepareStartJobSnapshot).mockReset().mockResolvedValue(preparedMarkerJob());
    vi.mocked(jobAwareAlert).mockReset();
    vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
    vi.mocked(prepareTransientFrameController)
      .mockReset()
      .mockImplementation(async () => ({ laser: useLaserStore.getState() }));
    vi.mocked(dispatchTransientReviewedFrame)
      .mockReset()
      .mockImplementation(async (review) => installTransientPermit(review));
  });

  afterEach(() => {
    useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
    vi.restoreAllMocks();
  });

  it('passes current same-session $32=1 evidence into the camera-marker Start', async () => {
    const startJob = vi.fn<typeof originalStartJob>(async (_gcode, options) => {
      options?.assertFinalStartAuthorized?.();
    });
    setReadyLaser(startJob, true);

    await expect(runTransientCameraJob(createProject())).resolves.toBe(true);

    const options = startJob.mock.calls[0]?.[1] as
      | {
          readonly laserModeStartEvidence?: LaserModeStartEvidence;
          readonly framedRunPermit?: FramedRunPermit;
        }
      | undefined;
    expect(options?.laserModeStartEvidence).toMatchObject({
      controllerSessionEpoch: 7,
      settingsObservation: { sessionEpoch: 7, observedAt: 100 },
      laserModeEnabled: true,
      unverifiedAcknowledged: false,
    });
    expect(options?.framedRunPermit?.candidate.authorizationContext).toBe('transient-camera');
    expect(vi.mocked(prepareStartJobSnapshot).mock.calls[0]?.[6]).toMatchObject({
      requireFrame: false,
    });
    expect(dispatchTransientReviewedFrame).toHaveBeenCalledOnce();
    expect(vi.mocked(dispatchTransientReviewedFrame).mock.invocationCallOrder[0]).toBeLessThan(
      startJob.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });

  it('sends no marker bytes when the exact transient Frame does not complete', async () => {
    const startJob = vi.fn<typeof originalStartJob>(async () => undefined);
    setReadyLaser(startJob, true);
    vi.mocked(dispatchTransientReviewedFrame).mockResolvedValueOnce(null);

    await expect(runTransientCameraJob(createProject())).resolves.toBe(false);

    expect(dispatchTransientReviewedFrame).toHaveBeenCalledOnce();
    expect(startJob).not.toHaveBeenCalled();
  });

  it('prompts exactly once with the informed acknowledgement when only camera-marker $32 is unknown', async () => {
    const startJob = vi.fn<typeof originalStartJob>(async () => undefined);
    setReadyLaser(startJob, undefined);
    vi.mocked(prepareStartJobSnapshot).mockResolvedValue(
      preparedMarkerJob([LASER_MODE_GENERIC_WARNING]),
    );

    await expect(runTransientCameraJob(createProject())).resolves.toBe(true);

    expect(jobAwareConfirm).toHaveBeenCalledTimes(1);
    expect(jobAwareConfirm).toHaveBeenCalledWith(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(startJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        laserModeStartEvidence: expect.objectContaining({
          settingsCapability: 'readonly-dump',
          laserModeEnabled: undefined,
          unverifiedAcknowledged: true,
        }),
      }),
    );
  });

  it('retains unrelated camera warnings before the informed unknown-$32 acknowledgement', async () => {
    const startJob = vi.fn<typeof originalStartJob>(async () => undefined);
    setReadyLaser(startJob, undefined);
    vi.mocked(prepareStartJobSnapshot).mockResolvedValue(
      preparedMarkerJob([LASER_MODE_GENERIC_WARNING, UNRELATED_CAMERA_WARNING]),
    );

    await expect(runTransientCameraJob(createProject())).resolves.toBe(true);

    expect(jobAwareConfirm).toHaveBeenCalledTimes(2);
    expect(vi.mocked(jobAwareConfirm).mock.calls[0]?.[0]).toContain(UNRELATED_CAMERA_WARNING);
    expect(vi.mocked(jobAwareConfirm).mock.calls[0]?.[0]).not.toContain(LASER_MODE_GENERIC_WARNING);
    expect(vi.mocked(jobAwareConfirm).mock.calls[1]?.[0]).toBe(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(startJob).toHaveBeenCalledOnce();
  });

  it('sends no camera-marker job when the unknown-$32 acknowledgement is declined', async () => {
    const startJob = vi.fn<typeof originalStartJob>(async () => undefined);
    setReadyLaser(startJob, undefined);
    vi.mocked(jobAwareConfirm).mockReturnValue(false);

    await expect(runTransientCameraJob(createProject())).resolves.toBe(false);

    expect(jobAwareConfirm).toHaveBeenCalledWith(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(startJob).not.toHaveBeenCalled();
  });

  it('requires an informed acknowledgement for a reported $32=0', async () => {
    const startJob = vi.fn<typeof originalStartJob>(async () => undefined);
    setReadyLaser(startJob, false);
    vi.mocked(prepareStartJobSnapshot).mockResolvedValue(
      preparedMarkerJob([LASER_MODE_DISABLED_WARNING]),
    );

    await expect(runTransientCameraJob(createProject())).resolves.toBe(true);

    expect(jobAwareAlert).not.toHaveBeenCalled();
    expect(jobAwareConfirm).toHaveBeenCalledTimes(1);
    expect(jobAwareConfirm).toHaveBeenCalledWith(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(startJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        laserModeStartEvidence: expect.objectContaining({
          laserModeEnabled: false,
          unverifiedAcknowledged: true,
        }),
      }),
    );
  });

  it('carries the reviewed evidence through later settings drift', async () => {
    const startJob = vi.fn<typeof originalStartJob>(async () => undefined);
    setReadyLaser(startJob, true);
    vi.mocked(prepareStartJobSnapshot).mockImplementation(async () => {
      useLaserStore.setState({
        controllerSettings: { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: false },
        controllerSettingsObservation: { sessionEpoch: 7, observedAt: 101 },
      });
      return preparedMarkerJob();
    });

    await expect(runTransientCameraJob(createProject())).resolves.toBe(true);

    expect(jobAwareAlert).not.toHaveBeenCalled();
    expect(startJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        laserModeStartEvidence: expect.objectContaining({
          settingsObservation: { sessionEpoch: 7, observedAt: 100 },
          laserModeEnabled: true,
          unverifiedAcknowledged: false,
        }),
      }),
    );
  });
});
