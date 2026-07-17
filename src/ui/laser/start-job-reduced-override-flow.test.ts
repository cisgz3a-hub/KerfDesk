import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import type { StatusReport } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { captureJobReviewModels, installAutoJobReview, useJobReviewStore } from './job-review';
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
  id: 'line',
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

describe('CNC reduced-override Start flow', () => {
  beforeEach(() => {
    resetStore();
    const project = {
      ...createProject(DEFAULT_DEVICE_PROFILE),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: {
        ...EMPTY_SCENE,
        objects: [lineObject],
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
      },
    };
    useStore.setState({ project, selectedObjectId: null, additionalSelectedIds: new Set() });
    useLaserStore.setState({
      ...initialLaserState(),
      connection: { kind: 'connected' },
      controllerSessionEpoch: CONTROLLER_EPOCH,
      controllerQualification: {
        kind: 'qualified',
        epoch: CONTROLLER_EPOCH,
        settings: 'verified',
      },
      statusReport: idleStatus,
      controllerSettings: { maxPowerS: 12000, minPowerS: 0, laserModeEnabled: false },
      ovCache: { feed: 80, rapid: 50, spindle: 60 },
      accessoryCache: { spindleCw: false, spindleCcw: false, flood: false, mist: false },
      workZReferenceEpoch: CONTROLLER_EPOCH,
      workZZeroEvidence: {
        source: 'manual-zero',
        referenceEpoch: CONTROLLER_EPOCH,
        toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
      },
      startJob: vi.fn(async () => undefined),
    });
    vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
    useJobReviewStore.getState().close();
    uninstallAutoReview = installAutoJobReview('confirm');
  });

  afterEach(() => {
    uninstallAutoReview();
    useJobReviewStore.getState().close();
    useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
    vi.restoreAllMocks();
  });

  it('binds the acknowledged feed/rapid reduction to setup attestation', async () => {
    const review = captureJobReviewModels();

    await runStartJobFlow();

    review.stop();
    const acknowledgement = review.models.at(-1)?.acknowledgement;
    expect(acknowledgement?.kind).toBe('cnc');
    expect(
      acknowledgement !== undefined && 'prompt' in acknowledgement ? acknowledgement.prompt : '',
    ).toMatch(/feed 80%, rapid 50%, spindle 60%/i);
    expect(jobAwareConfirm).not.toHaveBeenCalled();
    const startJob = vi.mocked(useLaserStore.getState().startJob);
    expect(startJob.mock.calls[0]?.[1]?.cncSetupAttestation).toMatchObject({
      acknowledgedReducedOverrides: { feed: 80, rapid: 50, spindle: 60 },
    });
  });
});
