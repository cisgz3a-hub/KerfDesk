// Job Review's re-prepare on Confirm reuses the displayed compile when every
// input it depends on is unchanged, and still recompiles when one is not
// (ADR-345). Split from job-review-gate.test.ts at the file-size cap.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { captureLaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { resetStore } from '../../state/test-helpers';
import { prepareCurrentStartJob } from '../start-job-source';
import { runJobReviewGate } from './job-review-gate';
import { useJobReviewStore } from './job-review-store';
import { captureJobReviewModels } from './testing';

vi.mock('../../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const CONTROLLER_EPOCH = 7;

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

async function unframedReviewBundle() {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const camera = useCameraStore.getState();
  const prepared = await prepareCurrentStartJob(app, laser, camera, undefined, false);
  if (!prepared.ok)
    throw new Error(`Frame review preparation failed: ${prepared.messages.join(' / ')}`);
  return {
    app,
    project: app.project,
    laser,
    prepared,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
  };
}

beforeEach(() => {
  resetStore();
  const project = {
    ...createProject(DEFAULT_DEVICE_PROFILE),
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
    statusReport: idleStatus,
    activeWcs: 'G54',
    controllerSessionEpoch: CONTROLLER_EPOCH,
    controllerQualification: { kind: 'qualified', epoch: CONTROLLER_EPOCH, settings: 'verified' },
    controllerSettings: {
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
      laserModeEnabled: true,
    },
    controllerSettingsObservation: { sessionEpoch: CONTROLLER_EPOCH, observedAt: 1 },
    startJob: vi.fn(async () => undefined),
  });
  useJobReviewStore.getState().close();
});

afterEach(() => {
  useJobReviewStore.getState().close();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('Job Review reuse of the displayed compile', () => {
  it('reuses the displayed compile on Confirm when nothing it depends on changed', async () => {
    const initial = await unframedReviewBundle();
    const capture = captureJobReviewModels();
    const review = runJobReviewGate({
      initial,
      checkpointToReplace: null,
      completedReceipt: null,
      purpose: 'frame',
    });
    await vi.waitFor(() => expect(capture.models).toHaveLength(1));
    useJobReviewStore.getState().confirm();
    const confirmed = await review;
    capture.stop();
    expect(confirmed?.bundle.prepared).toBe(initial.prepared);
    // The bundle still carries the live controller snapshot, not the stale one.
    expect(confirmed?.bundle.laser).toBe(useLaserStore.getState());
  });

  it('recompiles on Confirm after the project changed under the review', async () => {
    const initial = await unframedReviewBundle();
    const capture = captureJobReviewModels();
    const review = runJobReviewGate({
      initial,
      checkpointToReplace: null,
      completedReceipt: null,
      purpose: 'frame',
    });
    await vi.waitFor(() => expect(capture.models).toHaveLength(1));
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          layers: project.scene.layers.map((layer) => ({ ...layer, power: 42 })),
        },
      },
    });
    useJobReviewStore.getState().confirm();
    await vi.waitFor(() => expect(capture.models).toHaveLength(2));
    useJobReviewStore.getState().confirm();
    const confirmed = await review;
    capture.stop();
    expect(confirmed?.bundle.prepared).not.toBe(initial.prepared);
    expect(confirmed?.bundle.prepared.gcode).not.toBe(initial.prepared.gcode);
  });

  it('recompiles on Confirm when the controller evidence changed', async () => {
    const initial = await unframedReviewBundle();
    const capture = captureJobReviewModels();
    const review = runJobReviewGate({
      initial,
      checkpointToReplace: null,
      completedReceipt: null,
      purpose: 'frame',
    });
    await vi.waitFor(() => expect(capture.models).toHaveLength(1));
    useLaserStore.setState({ statusReport: { ...idleStatus, mPos: { x: 5, y: 5, z: 0 } } });
    useJobReviewStore.getState().confirm();
    const confirmed = await review;
    capture.stop();
    expect(confirmed?.bundle.prepared).not.toBe(initial.prepared);
  });
});
