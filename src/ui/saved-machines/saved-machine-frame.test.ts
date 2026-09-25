// Frame-first (PROJECT.md non-negotiable 21): a completed Frame belongs to the
// machine it was traced on, so a machine switch ends it even when the switched
// profile would compile the same program. Saving the open machine to My
// machines only labels the project and keeps the Frame.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  EMPTY_SAVED_MACHINE_LIST,
  addSavedMachine,
  createSavedMachine,
} from '../../core/saved-machines/saved-machine-list';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { clearFrameExpiryNote, frameExpiryReason } from '../laser/frame-expiry-note';
import { ensureFramedRunInvalidationSubscriptions } from '../laser/framed-run-invalidation';
import {
  idleControllerStatusForFrameTest,
  installReviewPendingFramedRunPermitForCurrentState,
} from '../laser/framed-run-testing';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { useSavedMachinesStore } from '../state/saved-machines-store';
import { resetStore } from '../state/test-helpers';
import { saveCurrentMachineAsNew } from './saved-machine-actions';
import { switchToSavedMachine } from './switch-saved-machine';

const lineObject: SceneObject = {
  kind: 'imported-svg',
  id: 'saved-machine-frame-line',
  source: 'saved-machine-frame-line.svg',
  bounds: { minX: 10, minY: 20, maxX: 110, maxY: 20 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 10, y: 20 },
            { x: 110, y: 20 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

const FRAMED_DEVICE = {
  ...DEFAULT_DEVICE_PROFILE,
  homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
};

function saveMachine(id: string, profile: typeof FRAMED_DEVICE, name: string): void {
  const list = addSavedMachine(
    useSavedMachinesStore.getState().list,
    createSavedMachine({ id, profile, machineKind: 'laser', name, now: 1 }),
  );
  useSavedMachinesStore.setState({ list, persistFailed: false });
}

beforeEach(() => {
  resetStore();
  useSavedMachinesStore.setState({ list: EMPTY_SAVED_MACHINE_LIST, persistFailed: false });
  useStore.setState({
    project: {
      ...createProject(FRAMED_DEVICE),
      scene: {
        ...EMPTY_SCENE,
        objects: [lineObject],
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
      },
    },
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useCameraStore.setState({
    placementActive: false,
    confirmedPositionEpoch: null,
    surfaceHeightMm: 0,
  });
  const evidence = stockNativeEvidence(useStore.getState().project.device, true);
  useLaserStore.setState({
    ...initialLaserState(),
    ...evidence,
    connection: { kind: 'connected' },
    statusReport: idleControllerStatusForFrameTest(),
    controllerSessionEpoch: 7,
    trustedPositionEpoch: 3,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    controllerSettings: { ...evidence.controllerSettings, reportInches: false },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
  });
  ensureFramedRunInvalidationSubscriptions();
  clearFrameExpiryNote();
});

afterEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  useSavedMachinesStore.setState({ list: EMPTY_SAVED_MACHINE_LIST, persistFailed: false });
  clearFrameExpiryNote();
});

describe('saved machines and the completed Frame', () => {
  it('expires the Frame when switching to a saved machine with identical settings', async () => {
    saveMachine('clone', FRAMED_DEVICE, 'Bench clone');
    await installReviewPendingFramedRunPermitForCurrentState();

    const result = switchToSavedMachine('clone');

    expect(result.kind).toBe('switched');
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(useLaserStore.getState().frameTrace ?? null).toBeNull();
    expect(frameExpiryReason()).toBe('The machine changed to “Bench clone” after Frame.');
  });

  it('expires the Frame and says why when switching to a different machine', async () => {
    saveMachine('wide', { ...FRAMED_DEVICE, bedWidth: 600, bedHeight: 500 }, 'Wide bed');
    await installReviewPendingFramedRunPermitForCurrentState();

    switchToSavedMachine('wide');

    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useStore.getState().project.device.bedWidth).toBe(600);
    expect(frameExpiryReason()).toBe('The machine changed to “Wide bed” after Frame.');
  });

  it('keeps the Frame when the open machine is saved to My machines', async () => {
    const permit = await installReviewPendingFramedRunPermitForCurrentState();

    const machine = saveCurrentMachineAsNew({ rememberController: false });

    expect(useStore.getState().project.device.savedMachineId).toBe(machine.id);
    expect(useLaserStore.getState().framedRun).toBe(permit);
    expect(frameExpiryReason()).toBeNull();
  });

  it('says nothing about a Frame when none had completed', () => {
    saveMachine('clone', FRAMED_DEVICE, 'Bench clone');

    switchToSavedMachine('clone');

    expect(frameExpiryReason()).toBeNull();
  });
});
