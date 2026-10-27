/** @vitest-environment jsdom */
// Rolling audit v3 G6-P2-3 (ADR-440 Amendment 5): a head camera's stitched
// bed picture was kept in the scene millimetres it was captured in. In the
// refuter's repro, on a front-left 400 × 400 bed, its corner at scene
// (100, 100) showed machine (100, 300). After the bed was corrected to 410 it
// stayed at scene (100, 100), which burns at (100, 310), while the Camera
// panel said the picture was moved to match. After an origin change it was
// still drawn, mirrored, and it survived opening another machine's project.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CameraBedFrame } from '../../core/camera/model/camera-bed-frame';
import type { BedArea } from '../../core/camera/model/camera-model-accuracy';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords, type DeviceProfile } from '../../core/devices';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore, type BedPicture } from '../state/camera-store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import {
  bedPictureNow,
  bedPictureTakenNow,
  followBedPictureFrame,
  ORIGIN_CHANGED,
  OTHER_MACHINE,
  useBedPictureRegion,
} from './bed-picture-frame';

const MACHINE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'falcon-a1-pro',
  name: 'Creality Falcon A1 Pro',
  origin: 'front-left',
  bedWidth: 400,
  bedHeight: 400,
};
const FRAME_400: CameraBedFrame = { origin: 'front-left', bedWidthMm: 400, bedHeightMm: 400 };
const REGION: BedArea = { x: 100, y: 100, width: 50, height: 50 };

function picture(bedFrame: CameraBedFrame = FRAME_400): BedPicture {
  return {
    image: { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 },
    region: REGION,
    surfaceHeightMm: 3,
    taken: { bedFrame, machine: 'falcon-a1-pro' },
  };
}

function toasts(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

describe('where a bed picture is drawn now', () => {
  it('moves with the bed after a bed-size change, so what it shows burns where it is drawn', () => {
    // Corner scene (100, 100) of the 400 mm bed shows machine (100, 300).
    expect(toMachineCoords({ x: 100, y: 100 }, MACHINE)).toEqual({ x: 100, y: 300 });
    const now = { bedFrame: { ...FRAME_400, bedHeightMm: 410 }, machine: 'falcon-a1-pro' };
    const placed = bedPictureNow(picture(), now);
    expect(placed).toEqual({
      kind: 'shown',
      region: { ...REGION, y: 110 },
      movedMm: 10,
    });
    if (placed.kind !== 'shown') return;
    // Drawn at scene (100, 110), which on the 410 mm bed burns at machine (100, 300).
    const burns = toMachineCoords(placed.region, { ...MACHINE, bedHeight: 410 });
    expect(burns.x).toBeCloseTo(100, 9);
    expect(burns.y).toBeCloseTo(300, 9);
  });

  it('follows a native offset change only when both offsets are known', () => {
    const homed = { ...FRAME_400, nativeToBedOffsetMm: { x: 0, y: 0 } };
    const moved = { ...FRAME_400, nativeToBedOffsetMm: { x: 0, y: 4 } };
    const placed = bedPictureNow(picture(homed), { bedFrame: moved, machine: 'falcon-a1-pro' });
    expect(placed).toMatchObject({ kind: 'shown', movedMm: 4 });
    // Disconnected: an unknown offset is not evidence that it changed.
    const unknown = bedPictureNow(picture(homed), {
      bedFrame: FRAME_400,
      machine: 'falcon-a1-pro',
    });
    expect(unknown).toEqual({ kind: 'shown', region: REGION, movedMm: 0 });
  });

  it('is dropped after an origin change, which would mirror it against the burn', () => {
    const now = {
      bedFrame: { ...FRAME_400, origin: 'rear-left' as const },
      machine: 'falcon-a1-pro',
    };
    expect(bedPictureNow(picture(), now)).toEqual({ kind: 'dropped', message: ORIGIN_CHANGED });
  });

  it('is dropped on another machine', () => {
    const now = { bedFrame: FRAME_400, machine: 'generic-grbl-400x400' };
    expect(bedPictureNow(picture(), now)).toEqual({ kind: 'dropped', message: OTHER_MACHINE });
  });
});

describe('following Machine Setup and Open', () => {
  let stop: () => void = () => undefined;

  beforeEach(() => {
    resetStore();
    useStore.setState({ project: createProject(MACHINE) });
    useToastStore.setState({ toasts: [] });
    useCameraStore.setState({ bedPicture: null, overlayStill: null, overlayVisible: true });
    stop = followBedPictureFrame();
  });

  afterEach(() => stop());

  function capture(): BedPicture {
    const taken = { ...picture(), taken: bedPictureTakenNow() };
    useCameraStore.getState().setBedPicture(taken);
    return taken;
  }

  it('keeps the picture after a bed correction and says it moves it', () => {
    const taken = capture();
    expect(taken.taken).toEqual({ bedFrame: FRAME_400, machine: 'falcon-a1-pro' });
    useStore.getState().updateDeviceProfile({ bedHeight: 410 });
    // Kept as captured, so the burn check's own Show / Hide still knows it.
    expect(useCameraStore.getState().bedPicture).toBe(taken);
    expect(toasts()).toEqual([
      'The bed picture was taken on a 400 × 400 mm bed. KerfDesk moves it 10 mm to match the machine as it is set up now.',
    ]);
    // Setting the bed back needs no word.
    useStore.getState().updateDeviceProfile({ bedHeight: 400 });
    expect(toasts()).toHaveLength(1);
  });

  it('clears the picture after an origin change and says why', () => {
    capture();
    useStore.getState().updateDeviceProfile({ origin: 'rear-left' });
    expect(useCameraStore.getState().bedPicture).toBeNull();
    expect(toasts()).toEqual([ORIGIN_CHANGED]);
  });

  it('clears the picture when a project for another machine opens, and keeps it for this one', () => {
    capture();
    useStore.getState().setProject(createProject(MACHINE));
    expect(useCameraStore.getState().bedPicture).not.toBeNull();
    useStore.getState().setProject(createProject(DEFAULT_DEVICE_PROFILE));
    expect(useCameraStore.getState().bedPicture).toBeNull();
    expect(toasts()).toContain(OTHER_MACHINE);
  });
});

describe('useBedPictureRegion', () => {
  let container: HTMLDivElement;
  let root: Root;

  function Probe(props: { readonly picture: BedPicture }): JSX.Element {
    return <output>{JSON.stringify(useBedPictureRegion(props.picture))}</output>;
  }

  beforeEach(() => {
    resetStore();
    useStore.setState({ project: createProject(MACHINE) });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('gives the region the overlay draws as Machine Setup changes', () => {
    const taken = picture();
    act(() => root.render(<Probe picture={taken} />));
    expect(JSON.parse(container.textContent ?? '')).toEqual(REGION);
    act(() => useStore.getState().updateDeviceProfile({ bedHeight: 410 }));
    expect(JSON.parse(container.textContent ?? '')).toEqual({ ...REGION, y: 110 });
    act(() => useStore.getState().updateDeviceProfile({ origin: 'rear-left' }));
    expect(JSON.parse(container.textContent ?? '')).toBeNull();
  });
});
