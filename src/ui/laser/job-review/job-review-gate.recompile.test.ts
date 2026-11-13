// Code quality audit C2, D3 (test strength): the negative side of Job Review's
// "reuse the displayed compile" shortcut (ADR-345) and of its other Confirm
// guards. job-review-gate.reuse.test.ts proves the reuse happens when nothing
// changed; each test here changes one input and expects the gate not to bind
// Confirm to the displayed bytes, or not to confirm at all.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { fingerprintGcode } from '../../../core/recovery';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { captureLaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import type { LastCompletedReceipt } from '../../state/recovery';
import { resetStore } from '../../state/test-helpers';
import { prepareCurrentStartJob, startMachineInputsKey } from '../start-job-source';
import { currentReplayExecutionSignature } from '../start-job-execution-tracking';
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

async function reviewBundle() {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const camera = useCameraStore.getState();
  const preparedMachineInputsKey = startMachineInputsKey(app.project, laser, camera);
  const prepared = await prepareCurrentStartJob(app, laser, camera, undefined, false);
  if (!prepared.ok) throw new Error(`Review preparation failed: ${prepared.messages.join(' / ')}`);
  return {
    app,
    project: app.project,
    laser,
    prepared,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
    preparedMachineInputsKey,
  };
}

/** Same content, new identity: the reuse shortcut must recompile, and the
 * recompile reproduces the same bytes. */
function sameProjectNewIdentity(): void {
  useStore.setState({ project: { ...useStore.getState().project } });
}

/** One character of a coordinate swapped: the bytes differ, while the line
 * count and size the review shows do not. */
function sameShapeOtherBytes(gcode: string): string {
  const match = /X(\d)/.exec(gcode);
  if (match === null || match.index === undefined) throw new Error('No X word to change.');
  const digit = match[1] === '9' ? '8' : '9';
  return `${gcode.slice(0, match.index + 1)}${digit}${gcode.slice(match.index + 2)}`;
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
  useCameraStore.setState({ placementActive: false, confirmedPositionEpoch: null });
});

afterEach(() => {
  useJobReviewStore.getState().close();
  useCameraStore.setState({ placementActive: false, confirmedPositionEpoch: null });
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

// J01, J04, J05, J06. A time-bound project (J03) needs the output Worker stand-in
// and is in job-review-gate.variable-clock.test.ts.
describe('Job Review recompiles on Confirm when one reuse input changed', () => {
  it.each([
    {
      // J04: equal values, but a new read. The machine-inputs key compares
      // values, so only the controller staleness check sees it.
      input: 'the controller settings were read again',
      change: () =>
        useLaserStore.setState((laser) => ({
          controllerSettings:
            laser.controllerSettings === null ? null : { ...laser.controllerSettings },
        })),
    },
    {
      // J05: a controller fact only the machine-inputs key holds.
      input: 'the controller reported new overrides',
      change: () => useLaserStore.setState({ ovCache: { feed: 120, rapid: 100, spindle: 100 } }),
    },
    {
      // C2 verification E3-P2-1: camera facts are not on the controller state,
      // so only the key taken when the compile was prepared shows them.
      input: 'camera placement was turned on',
      change: () => useCameraStore.setState({ placementActive: true }),
    },
    {
      input: 'a camera position was confirmed',
      change: () => useCameraStore.setState({ confirmedPositionEpoch: 1 }),
    },
    {
      // J06 sits behind J05: every input of the coordinate key is also a
      // machine input, so this row fails only when both checks are gone.
      input: 'a homed native bed frame changed the coordinate key',
      change: () => useLaserStore.setState({ homingState: 'confirmed' }),
    },
  ])('recompiles when $input', async ({ change }) => {
    const initial = await reviewBundle();
    const capture = captureJobReviewModels();
    const review = runJobReviewGate({ initial, completedReceipt: null, purpose: 'frame' });
    await vi.waitFor(() => expect(capture.models).toHaveLength(1));

    change();
    useJobReviewStore.getState().confirm();
    let settled = false;
    void review.then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(settled || capture.models.length > 1).toBe(true));
    if (!settled) useJobReviewStore.getState().confirm();
    const confirmed = await review;
    capture.stop();

    expect(confirmed).not.toBeNull();
    expect(confirmed?.bundle.prepared).not.toBe(initial.prepared);
  });

  // J01: a recompile whose bytes differ from the displayed ones, while the
  // review model (line count, size, warnings) is equal, still needs a new click.
  it('asks for a second Confirm when the recompiled bytes differ under an equal model', async () => {
    const fresh = await reviewBundle();
    const shown = sameShapeOtherBytes(fresh.prepared.gcode);
    expect(shown).toHaveLength(fresh.prepared.gcode.length);
    const initial = { ...fresh, prepared: { ...fresh.prepared, gcode: shown } };
    const capture = captureJobReviewModels();
    const review = runJobReviewGate({ initial, completedReceipt: null, purpose: 'frame' });
    await vi.waitFor(() => expect(capture.models).toHaveLength(1));

    sameProjectNewIdentity();
    let settled = false;
    void review.then(() => {
      settled = true;
    });
    useJobReviewStore.getState().confirm();
    await vi.waitFor(() => expect(settled || capture.models.length > 1).toBe(true));
    expect(settled).toBe(false);
    expect(JSON.stringify(capture.models[1])).toBe(JSON.stringify(capture.models[0]));

    useJobReviewStore.getState().confirm();
    const confirmed = await review;
    capture.stop();
    expect(confirmed?.bundle.prepared.gcode).toBe(fresh.prepared.gcode);
  });
});

// D3R-P2-1 (mutant J09): the re-prepare at Confirm is the only place the
// review's own abort signal is checked on the main-thread path.
describe('Cancel while Confirm re-prepares', () => {
  it('returns no confirmed review and starts nothing', async () => {
    const initial = await reviewBundle();
    const capture = captureJobReviewModels();
    const review = runJobReviewGate({ initial, completedReceipt: null, purpose: 'frame' });
    await vi.waitFor(() => expect(capture.models).toHaveLength(1));
    sameProjectNewIdentity();
    let cancelled = false;
    const unsubscribe = useJobReviewStore.subscribe((store) => {
      if (!cancelled && store.state.kind === 'open' && store.state.isPreparing) {
        cancelled = true;
        queueMicrotask(() => useJobReviewStore.getState().cancelAndClose());
      }
    });

    useJobReviewStore.getState().confirm();
    const confirmed = await review;
    unsubscribe();
    capture.stop();

    expect(cancelled).toBe(true);
    expect(confirmed).toBeNull();
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
  });
});

// D3 mutants J08 and J14: Run again replays a completed run. Each test breaks
// the input of exactly one of the two replay guards; the other still agrees.
describe('Run again replay guards', () => {
  function receiptFor(executionSignature: string, gcode: string): LastCompletedReceipt {
    return {
      runId: 'completed-run',
      completedAtIso: '2026-11-12T10:00:00.000Z',
      artifact: { executionSignature, fingerprint: fingerprintGcode(gcode) },
    } as unknown as LastCompletedReceipt;
  }

  async function replay(
    initial: Awaited<ReturnType<typeof reviewBundle>>,
    completedReceipt: LastCompletedReceipt,
  ) {
    const onCompletedReplayChanged = vi.fn();
    const capture = captureJobReviewModels();
    const review = runJobReviewGate({
      initial,
      completedReceipt,
      purpose: 'frame',
      onCompletedReplayChanged,
    });
    await vi.waitFor(() => expect(capture.models).toHaveLength(1));
    useJobReviewStore.getState().confirm();
    const confirmed = await review;
    capture.stop();
    return { confirmed, onCompletedReplayChanged };
  }

  it('closes when the compile no longer matches the completed program (J08)', async () => {
    const initial = await reviewBundle();
    const receipt = receiptFor(
      currentReplayExecutionSignature(useStore.getState()),
      sameShapeOtherBytes(initial.prepared.gcode),
    );

    const { confirmed, onCompletedReplayChanged } = await replay(initial, receipt);

    expect(confirmed).toBeNull();
    expect(onCompletedReplayChanged).toHaveBeenCalledOnce();
  });

  it('closes when the job is no longer the completed one, even with a matching compile (J14)', async () => {
    // The completed run and the reviewed compile belong to the job before the
    // edit; the edit (a layer's power) now changes the job's signature.
    const before = await reviewBundle();
    const receipt = receiptFor(before.prepared.canvasPlan.retentionKey, before.prepared.gcode);
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
    const app = useStore.getState();
    expect(currentReplayExecutionSignature(app)).not.toBe(receipt.artifact.executionSignature);
    const initial = { ...before, app, project: app.project };

    const { confirmed, onCompletedReplayChanged } = await replay(initial, receipt);

    expect(confirmed).toBeNull();
    expect(onCompletedReplayChanged).toHaveBeenCalledOnce();
  });
});
