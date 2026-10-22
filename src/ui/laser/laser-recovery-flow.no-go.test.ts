// Audit v3 D5-P2-4, ADR-232 Amendment 1: a saved laser recovery confirms the
// no-go zones its own re-entry move crosses, and records them with the run.
// Scene from the audit: B (300..320, 10..30) is cut first, A (10..30,
// 350..370) second, and a rear clamp spans X 100..200, Y 360..400. The job
// stops in A and the operator homes, so the head stands at (390, 390).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { RecoveryRepository, type RecoveryCapsule } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';
import { installFramedRunPermitForCurrentState } from './framed-run-testing';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import { runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const REAR_CLAMP = {
  id: 'rear',
  name: 'Rear clamp',
  enabled: true,
  x: 100,
  y: 360,
  width: 100,
  height: 40,
};
let uninstallAutoReview: () => void = () => undefined;

function square(id: string, x: number, y: number): SceneObject {
  const points = [
    { x, y },
    { x: x + 20, y },
    { x: x + 20, y: y + 20 },
    { x, y: y + 20 },
  ];
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: y, maxX: x + 20, maxY: y + 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [{ points, closed: true }] }],
  };
}

function project(): Project {
  const device: DeviceProfile = {
    ...DEFAULT_DEVICE_PROFILE,
    origin: 'front-left',
    bedWidth: 400,
    bedHeight: 400,
    homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    noGoZones: [REAR_CLAMP],
  };
  const base = createProject(device);
  // Scene Y runs down: A lands at bed (10..30, 350..370), B at (300..320, 10..30).
  const scene = addObject(addObject(base.scene, square('A', 10, 30)), square('B', 300, 370));
  return { ...base, scene: addLayer(scene, createLayer({ id: 'L1', color: '#ff0000' })) };
}

function idleAt(x: number, y: number): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x, y, z: 0 },
    wPos: null,
    wco: { x: 0, y: 0, z: 0 },
    feed: 0,
    spindle: 0,
  };
}

function recoveryHarness(): RecoveryRepository {
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
}

async function interruptedCapsule(repository: RecoveryRepository): Promise<RecoveryCapsule> {
  await runStartJobFlow(repository);
  const active = repository.getSnapshot().activeRun;
  if (active === null) throw new Error('Expected an active exact run.');
  await repository.interruptRun(active.runId, 0, { kind: 'disconnect', message: 'Stopped in A' });
  const capsule = repository.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('Expected an exact recovery capsule.');
  return capsule;
}

/** The 1-based line of A's first lit move, where the job stopped. */
function lineInPartA(capsule: RecoveryCapsule): number {
  if (capsule.artifact.kind !== 'exact-execution') throw new Error('Expected exact artifact.');
  const lines = capsule.artifact.gcode.split('\n');
  return lines.findIndex((line) => line.startsWith('G1 X30.000 Y370.000')) + 1;
}

beforeEach(async () => {
  resetStore();
  const target = project();
  useStore.setState({ project: target, selectedObjectId: null, additionalSelectedIds: new Set() });
  const evidence = stockNativeEvidence(target.device, true);
  useLaserStore.setState({
    ...initialLaserState(),
    ...evidence,
    connection: { kind: 'connected' },
    controllerQualification: {
      kind: 'qualified',
      epoch: evidence.controllerSessionEpoch,
      settings: 'verified',
    },
    statusReport: idleAt(0, 0),
    wcoCache: { x: 0, y: 0, z: 0 },
    startJob: vi.fn(async () => undefined),
  });
  await installFramedRunPermitForCurrentState();
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

describe('saved laser recovery and no-go zones', () => {
  it('confirms the re-entry crossing from the homed head and records it with the run', async () => {
    const repository = recoveryHarness();
    const capsule = await interruptedCapsule(repository);
    const fromLine = lineInPartA(capsule);
    expect(fromLine).toBeGreaterThan(0);
    // The operator homed after the stop: the head is at the rear-right corner.
    useLaserStore.setState({ statusReport: idleAt(390, 390) });
    vi.mocked(jobAwareConfirm).mockClear();

    expect(await runLaserRecoveryCapsuleFlow(capsule, repository, { fromLine })).toBe(true);

    expect(jobAwareConfirm).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Controller warning:[\s\S]*re-entry move \(G0 X10 Y370 S0\)[\s\S]*"Rear clamp"/,
      ),
    );
    expect(
      repository.getSnapshot().activeRun?.artifact.provenance?.review?.warningsShown,
    ).toContainEqual(expect.stringContaining('"Rear clamp"'));
  });

  it('starts nothing when the operator declines the crossing', async () => {
    const repository = recoveryHarness();
    const capsule = await interruptedCapsule(repository);
    const fromLine = lineInPartA(capsule);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ statusReport: idleAt(390, 390), startJob });
    vi.mocked(jobAwareConfirm).mockImplementation((message) => !message.includes('Rear clamp'));

    expect(await runLaserRecoveryCapsuleFlow(capsule, repository, { fromLine })).toBe(false);

    expect(startJob).not.toHaveBeenCalled();
    expect(repository.getSnapshot().recoveryCapsule).toMatchObject({ runId: capsule.runId });
  });
});
