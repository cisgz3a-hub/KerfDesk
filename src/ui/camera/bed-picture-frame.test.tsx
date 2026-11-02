/** @vitest-environment jsdom */
// Rolling audit v3 G6-P2-3 (ADR-440 Amendment 5): a head camera's stitched
// bed picture was kept in the scene millimetres it was captured in. In the
// refuter's repro, on a front-left 400 × 400 bed, its corner at scene
// (100, 100) showed machine (100, 300). After the bed was corrected to 410 it
// stayed at scene (100, 100), which burns at (100, 310), while the Camera
// panel said the picture was moved to match. After an origin change it was
// still drawn, mirrored, and it survived opening another machine's project.
// Rolling audit v4 H6-P1-2 (ADR-449 Amendment 2): it was also kept after the
// material height or a height area over it changed, drawn where the old
// heights put it.

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
  HEIGHTS_CHANGED,
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
    heightAreas: [],
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

  it('compares captured height areas after moving them into the current frame', () => {
    const box = { id: 'box', x: 120, y: 120, width: 10, height: 10, surfaceHeightMm: 20 };
    const taken = { ...picture(), heightAreas: [box] };
    const now = { bedFrame: { ...FRAME_400, bedHeightMm: 410 }, machine: 'falcon-a1-pro' };
    expect(
      bedPictureNow(taken, now, {
        surfaceHeightMm: 3,
        heightAreas: [{ ...box, y: 130 }],
      }),
    ).toMatchObject({ kind: 'shown', region: { ...REGION, y: 110 } });
    // The old scene coordinates now describe a different physical patch.
    expect(
      bedPictureNow(taken, now, {
        surfaceHeightMm: 3,
        heightAreas: [box],
      }),
    ).toEqual({ kind: 'dropped', message: HEIGHTS_CHANGED });
  });

  it('checks new raised areas against a picture moved by the native offset', () => {
    const taken = picture({ ...FRAME_400, nativeToBedOffsetMm: { x: 0, y: 0 } });
    const now = {
      bedFrame: { ...FRAME_400, nativeToBedOffsetMm: { x: 10, y: 0 } },
      machine: 'falcon-a1-pro',
    };
    expect(
      bedPictureNow(taken, now, {
        surfaceHeightMm: 3,
        heightAreas: [{ id: 'new', x: 152, y: 120, width: 5, height: 5, surfaceHeightMm: 20 }],
      }),
    ).toEqual({ kind: 'dropped', message: HEIGHTS_CHANGED });
  });
});

describe('following Machine Setup and Open', () => {
  let stop: () => void = () => undefined;

  beforeEach(() => {
    resetStore();
    useStore.setState({ project: createProject(MACHINE) });
    useToastStore.setState({ toasts: [] });
    useCameraStore.setState({
      bedPicture: null,
      overlayStill: null,
      overlayVisible: true,
      surfaceHeightMm: 3,
      heightAreas: [],
    });
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

  it('clears the picture when the material height changes after it was taken, and says why', () => {
    capture();
    // The audit's scenario B: taken at one height, Material height set to another.
    useCameraStore.getState().setSurfaceHeightMm(6);
    expect(useCameraStore.getState().bedPicture).toBeNull();
    expect(toasts()).toEqual([HEIGHTS_CHANGED]);
  });

  it('clears the picture when a height area over it changes, and keeps it for one elsewhere', () => {
    const taken = capture();
    const elsewhere = { id: 'far', x: 300, y: 300, width: 20, height: 20, surfaceHeightMm: 20 };
    useCameraStore.getState().addHeightArea(elsewhere);
    expect(useCameraStore.getState().bedPicture).toBe(taken);
    // A box standing on the pictured part of the bed, which the picture flattened at 3 mm.
    const box = { id: 'box', x: 120, y: 120, width: 20, height: 20, surfaceHeightMm: 20 };
    useCameraStore.getState().addHeightArea(box);
    expect(useCameraStore.getState().bedPicture).toBeNull();
    expect(toasts()).toEqual([HEIGHTS_CHANGED]);
  });

  it('keeps a picture flattened with a height area while the area stays as it was', () => {
    const box = { id: 'box', x: 120, y: 120, width: 20, height: 20, surfaceHeightMm: 20 };
    useCameraStore.getState().addHeightArea(box);
    const taken = { ...picture(), heightAreas: [box], taken: bedPictureTakenNow() };
    useCameraStore.getState().setBedPicture(taken);
    expect(useCameraStore.getState().bedPicture).toBe(taken);
    useCameraStore.getState().updateHeightArea('box', { surfaceHeightMm: 25 });
    expect(useCameraStore.getState().bedPicture).toBeNull();
  });

  it('clears a moved picture for a new area over its displayed region', () => {
    capture();
    useStore.getState().updateDeviceProfile({ bedHeight: 410 });
    useCameraStore.getState().addHeightArea({
      id: 'raised',
      x: 120,
      y: 152,
      width: 10,
      height: 5,
      surfaceHeightMm: 20,
    });
    expect(useCameraStore.getState().bedPicture).toBeNull();
    expect(toasts()).toContain(HEIGHTS_CHANGED);
  });

  it('keeps a moved picture when a new area overlaps only its old scene region', () => {
    const taken = capture();
    useStore.getState().updateDeviceProfile({ bedHeight: 410 });
    useCameraStore.getState().addHeightArea({
      id: 'elsewhere',
      x: 120,
      y: 102,
      width: 10,
      height: 5,
      surfaceHeightMm: 20,
    });
    expect(useCameraStore.getState().bedPicture).toBe(taken);
    expect(toasts()).not.toContain(HEIGHTS_CHANGED);
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
    useCameraStore.setState({ surfaceHeightMm: 3, heightAreas: [] });
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

  it('draws nothing while the material height differs from the one it was flattened at', () => {
    const taken = picture();
    act(() => root.render(<Probe picture={taken} />));
    expect(JSON.parse(container.textContent ?? '')).toEqual(REGION);
    act(() => useCameraStore.getState().setSurfaceHeightMm(6));
    expect(JSON.parse(container.textContent ?? '')).toBeNull();
  });

  it('stops drawing a moved image immediately when a raised area overlaps it', () => {
    const taken = picture();
    act(() => root.render(<Probe picture={taken} />));
    act(() => useStore.getState().updateDeviceProfile({ bedHeight: 410 }));
    act(() =>
      useCameraStore.getState().addHeightArea({
        id: 'raised',
        x: 120,
        y: 152,
        width: 10,
        height: 5,
        surfaceHeightMm: 20,
      }),
    );
    expect(JSON.parse(container.textContent ?? '')).toBeNull();
  });
});
