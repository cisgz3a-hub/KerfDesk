// Move laser to selection and the shared head-move dispatcher (ADR-493). The
// jog itself is the laser store's machine-position jog; these tests pin where
// it is asked to go and when nothing is sent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import {
  currentHeadPosition,
  dispatchHeadMove,
  HEAD_MOVE_NEEDS_CONNECTION,
  HEAD_MOVE_NEEDS_WORK_OFFSET,
  HEAD_MOVE_ROTARY_X_ONLY,
  HEAD_MOVE_UNVERIFIED_BED,
} from './head-move-dispatch';
import { useJogControlPreferences } from './jog-control-preferences';
import {
  MOVE_TO_SELECTION_NEEDS_ABSOLUTE,
  MOVE_TO_SELECTION_NEEDS_SELECTION,
  moveLaserToSelection,
} from './move-laser-to-selection';

const device: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  bedWidth: 400,
  bedHeight: 300,
  origin: 'front-left',
  maxFeed: 6000,
  homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
};

// A 20 x 10 mm shape whose canvas bounds are x 30..50, y 40..50.
const shape: ImportedSvg = {
  kind: 'imported-svg',
  id: 'a',
  source: 'a.svg',
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40 },
  operationIds: ['cut'],
  paths: [{ color: '#000000', polylines: [] }],
};

const idle = {
  state: 'Idle' as const,
  subState: null,
  mPos: { x: -10, y: -10, z: 0 },
  wPos: null,
  feed: null,
  spindle: null,
  wco: null,
};

function loadProject(selected: boolean, startFrom: 'absolute' | 'user-origin' = 'absolute') {
  useStore.setState({
    project: {
      ...createProject(),
      device,
      scene: {
        objects: [shape],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: selected ? 'a' : null,
    additionalSelectedIds: new Set(),
    jobPlacement: { ...useStore.getState().jobPlacement, startFrom },
  });
}

function connectMachine(verified: boolean, wcoCache: { x: number; y: number; z: number } | null) {
  const jogToMachinePosition = vi.fn(async () => undefined);
  useLaserStore.setState({
    ...(verified ? stockNativeEvidence(device) : {}),
    connection: { kind: 'connected' },
    streamer: null,
    motionOperation: null,
    statusReport: idle,
    wcoCache,
    jogToMachinePosition,
  });
  return jogToMachinePosition;
}

function lastToast(): string | undefined {
  return useToastStore.getState().toasts.at(-1)?.message;
}

const initialLaser = useLaserStore.getState();

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
  useJogControlPreferences.setState({ requestedFeedMmPerMin: 9000 });
});
afterEach(() => useLaserStore.setState(initialLaser, true));

describe('moveLaserToSelection', () => {
  it('jogs to the selection anchor through the verified bed frame, feed capped by the device', () => {
    loadProject(true);
    const jog = connectMachine(true, null);

    moveLaserToSelection('c');
    // Canvas (40, 45) -> machine (40, 255) -> stock GRBL native (-360, -45).
    expect(jog).toHaveBeenCalledWith(-360, -45, 6000);

    moveLaserToSelection('nw');
    // Canvas top-left (30, 40) is the back-left corner: machine (30, 260).
    expect(jog).toHaveBeenLastCalledWith(-370, -40, 6000);
  });

  it('goes where an Absolute job burns the point when the mapping is unverified, and says so', () => {
    loadProject(true);
    const jog = connectMachine(false, { x: 5, y: 5, z: 0 });

    moveLaserToSelection('se');

    expect(jog).toHaveBeenCalledWith(50, 250, 6000);
    expect(lastToast()).toBe(HEAD_MOVE_UNVERIFIED_BED);
  });

  it('moves X only on a rotary, whose Y is rotation from the job start', () => {
    loadProject(true);
    useStore.setState({
      project: {
        ...useStore.getState().project,
        device: {
          ...device,
          rotary: { enabled: true, type: 'roller', mmPerRotation: 360, objectDiameterMm: 60 },
        },
      },
    });
    const jog = connectMachine(true, null);

    moveLaserToSelection('c');

    // X as without the rotary; Y stays at the head's current native -10.
    expect(jog).toHaveBeenCalledWith(-360, -10, 6000);
    expect(lastToast()).toBe(HEAD_MOVE_ROTARY_X_ONLY);
  });

  it('explains instead of moving when the job is placed from the origin', () => {
    loadProject(true, 'user-origin');
    const jog = connectMachine(true, { x: 0, y: 0, z: 0 });

    moveLaserToSelection('c');

    expect(jog).not.toHaveBeenCalled();
    expect(lastToast()).toBe(MOVE_TO_SELECTION_NEEDS_ABSOLUTE);
  });

  it('asks for a selection when nothing is selected', () => {
    loadProject(false);
    const jog = connectMachine(true, null);

    moveLaserToSelection('c');

    expect(jog).not.toHaveBeenCalled();
    expect(lastToast()).toBe(MOVE_TO_SELECTION_NEEDS_SELECTION);
  });
});

describe('dispatchHeadMove', () => {
  it('sends nothing to a disconnected machine', () => {
    loadProject(false);
    const jog = vi.fn();
    useLaserStore.setState({ connection: { kind: 'disconnected' }, jogToMachinePosition: jog });

    expect(dispatchHeadMove({ frame: 'origin', xMm: 1, yMm: 2 }, 'X1 Y2')).toBe(false);
    expect(jog).not.toHaveBeenCalled();
    expect(lastToast()).toBe(HEAD_MOVE_NEEDS_CONNECTION);
  });

  it('adds the work offset to an origin position, homed or not', () => {
    loadProject(false);
    const jog = connectMachine(false, { x: 120, y: 80, z: -3 });

    expect(dispatchHeadMove({ frame: 'origin', xMm: 10, yMm: -5 }, 'X10 Y-5')).toBe(true);
    expect(jog).toHaveBeenCalledWith(130, 75, 6000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('waits for the work offset before an origin move', () => {
    loadProject(false);
    const jog = connectMachine(true, null);

    expect(dispatchHeadMove({ frame: 'origin', xMm: 10, yMm: 5 }, 'X10 Y5')).toBe(false);
    expect(jog).not.toHaveBeenCalled();
    expect(lastToast()).toBe(HEAD_MOVE_NEEDS_WORK_OFFSET);
  });

  it('reports a failed jog as a warning naming the target', async () => {
    loadProject(false);
    connectMachine(false, { x: 0, y: 0, z: 0 });
    useLaserStore.setState({
      jogToMachinePosition: vi.fn(async () => {
        throw new Error('Machine must be Idle');
      }),
    });

    dispatchHeadMove({ frame: 'origin', xMm: 1, yMm: 1 }, 'Corner stop');
    await vi.waitFor(() =>
      expect(lastToast()).toBe('Cannot move to Corner stop: Machine must be Idle'),
    );
  });
});

describe('currentHeadPosition', () => {
  it('reads the head in canvas and work coordinates', () => {
    loadProject(false);
    connectMachine(true, { x: -20, y: -30, z: 0 });

    // Native (-10, -10) -> machine (390, 290) -> canvas (390, 10).
    expect(currentHeadPosition('bed')).toEqual({ frame: 'bed', xMm: 390, yMm: 10 });
    expect(currentHeadPosition('origin')).toEqual({ frame: 'origin', xMm: 10, yMm: 20 });
  });
});
