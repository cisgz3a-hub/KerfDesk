import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { createProject } from '../../../core/scene';
import {
  LASER_MODE_DISABLED_AT_START_MESSAGE,
  type LaserModeStartEvidence,
} from '../../state/laser-mode-start-evidence';
import { initialLaserState } from '../../state/laser-store-helpers';
import { useLaserStore } from '../../state/laser-store';
import { jobAwareAlert, jobAwareConfirm } from '../../state/job-aware-dialogs';
import { LASER_MODE_UNVERIFIED_START_PROMPT } from '../../laser/laser-mode-start-acknowledgement';
import { prepareStartJobSnapshot, type StartJobPreparation } from '../../laser/start-job-readiness';
import { runTransientCameraJob } from './transient-camera-job';

vi.mock('../../laser/start-job-readiness', () => ({
  prepareStartJobSnapshot: vi.fn(),
}));

vi.mock('../../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
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

describe('runTransientCameraJob laser-mode evidence', () => {
  beforeEach(() => {
    vi.mocked(prepareStartJobSnapshot).mockReset().mockResolvedValue(preparedMarkerJob());
    vi.mocked(jobAwareAlert).mockReset();
    vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  });

  afterEach(() => {
    useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
    vi.restoreAllMocks();
  });

  it('passes current same-session $32=1 evidence into the camera-marker Start', async () => {
    const startJob = vi.fn<typeof originalStartJob>(async () => undefined);
    setReadyLaser(startJob, true);

    await expect(runTransientCameraJob(createProject())).resolves.toBe(true);

    const options = startJob.mock.calls[0]?.[1] as
      | { readonly laserModeStartEvidence?: LaserModeStartEvidence }
      | undefined;
    expect(options?.laserModeStartEvidence).toMatchObject({
      controllerSessionEpoch: 7,
      settingsObservation: { sessionEpoch: 7, observedAt: 100 },
      laserModeEnabled: true,
      unverifiedAcknowledged: false,
    });
    expect(jobAwareConfirm).not.toHaveBeenCalled();
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

  it('lets the real wire boundary refuse settings drift after camera preparation', async () => {
    setReadyLaser(originalStartJob, true);
    vi.mocked(prepareStartJobSnapshot).mockImplementation(async () => {
      useLaserStore.setState({
        controllerSettings: { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: false },
        controllerSettingsObservation: { sessionEpoch: 7, observedAt: 101 },
      });
      return preparedMarkerJob();
    });

    await expect(runTransientCameraJob(createProject())).resolves.toBe(false);

    expect(jobAwareAlert).toHaveBeenCalledWith(
      expect.stringContaining(LASER_MODE_DISABLED_AT_START_MESSAGE),
    );
  });
});
