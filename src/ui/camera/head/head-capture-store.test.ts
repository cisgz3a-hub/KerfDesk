// The head camera's capture from the Camera panel (ADR-449): what it asks for
// before it can capture, and Capture here turning one picture into a
// top-down picture on the canvas where the head is, flattened at the height
// areas and refused away from the calibration's Z (Amendment 2).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import type { LensModel } from '../../../core/camera/model/camera-model';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import { lookAt, savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { toSceneCoords, type DeviceProfile } from '../../../core/devices';
import { nativePointToBed } from '../../../core/devices/native-bed-frame';
import type { Vec2 } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { resolveManualMotionLimits } from '../../state/manual-motion-limits';
import { resolveNativeBedFrame } from '../../state/native-bed-frame';
import { stockNativeEvidence } from '../../state/native-bed-frame.test-support';
import { resetStore } from '../../state/test-helpers';
import type * as FrameSource from '../frame-source';
import { captureSourceFrame } from '../frame-source';
import {
  captureWithHeadCamera,
  HEAD_POSITION_UNKNOWN,
  useHeadCaptureStore,
} from './head-capture-store';

let head: (Vec2 & { readonly z?: number }) | null = null;
const initialLaser = useLaserStore.getState();

vi.mock('./head-position', () => ({
  headPositionNow: () => head,
  useHeadPositionOnBed: () => head,
}));
vi.mock('../frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: vi.fn(),
}));

const lens: LensModel = {
  intrinsics: { fx: 900, fy: 900, cx: 639.5, cy: 359.5 },
  distortion: [0.02, -0.01, 0, 0],
  imageWidth: 1280,
  imageHeight: 720,
};
const capture: CameraCaptureBinding = {
  version: 1,
  sourceKind: 'usb',
  sourceId: 'head-cam',
  width: 1280,
  height: 720,
  resizeMode: 'none',
};
// Calibrated with the head at (200, 150): 70 mm up, looking straight down.
const onHead: CameraModelRecord = {
  ...savedCameraModel(capture),
  lens,
  pose: lookAt([203, 148, -70], [203, 148.001, 0]),
  mount: { kind: 'head', headAtCalibrationMm: { x: 200, y: 150 } },
};

function goLive(): void {
  useCameraStore.setState({
    sourceState: {
      kind: 'live',
      source: {
        kind: 'usb',
        stream: {
          stream: {} as MediaStream,
          sourceId: 'head-cam',
          resizeMode: 'none',
          stop: () => undefined,
        },
      },
    },
  });
}

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaser, true);
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, bedWidth: 400, bedHeight: 300, cameraModel: onHead },
    },
  });
  useCameraStore.setState({
    sourceState: { kind: 'idle' },
    bedPicture: null,
    overlayVisible: false,
    surfaceHeightMm: 0,
    heightAreas: [],
  });
  useHeadCaptureStore.setState({ state: { kind: 'idle' } });
  vi.mocked(captureSourceFrame).mockReset();
  head = null;
});

describe('captureWithHeadCamera', () => {
  it('asks for the camera to be running first', async () => {
    await captureWithHeadCamera({ kind: 'here' });
    expect(useHeadCaptureStore.getState().state).toEqual({
      kind: 'failed',
      message: 'Start the head camera first.',
    });
  });

  it('asks for the head position when the machine is not homed', async () => {
    goLive();
    await captureWithHeadCamera({ kind: 'here' });
    expect(useHeadCaptureStore.getState().state).toEqual({
      kind: 'failed',
      message: HEAD_POSITION_UNKNOWN,
    });
    expect(captureSourceFrame).not.toHaveBeenCalled();
  });

  it('asks for the machine before moving the head over an area', async () => {
    goLive();
    head = { x: 100, y: 100 };
    await captureWithHeadCamera({ kind: 'area', area: { x: 0, y: 0, width: 400, height: 300 } });
    expect(useHeadCaptureStore.getState().state).toEqual({
      kind: 'failed',
      message: 'Connect the machine to move the head.',
    });
  });

  it('puts what the camera sees where the head is, without moving it', async () => {
    goLive();
    head = { x: 80, y: 220 };
    useLaserStore.setState({
      connection: { kind: 'connected' } as typeof initialLaser.connection,
      motionOperation: null,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 80, y: 220, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
    });
    const grey = {
      data: new Uint8ClampedArray(1280 * 720 * 4).fill(128),
      width: 1280,
      height: 720,
    };
    vi.mocked(captureSourceFrame).mockResolvedValue(grey);
    await captureWithHeadCamera({ kind: 'here' });

    expect(useHeadCaptureStore.getState().state).toEqual({ kind: 'finished', note: null });
    // Two pictures, keeping the one that began after the head was at rest.
    expect(captureSourceFrame).toHaveBeenCalledTimes(2);
    const picture = useCameraStore.getState().bedPicture;
    expect(picture).not.toBeNull();
    if (picture === null) return;
    const { region } = picture;
    // The camera looks 3 mm right of and 2 mm in front of the beam.
    expect(region.x + region.width / 2).toBeCloseTo(83, 0);
    expect(region.y + region.height / 2).toBeCloseTo(218, 0);
    expect(region.width).toBeGreaterThan(40);
    expect(picture.image.width).toBe(Math.round(region.width * 4));
    expect(useCameraStore.getState().overlayVisible).toBe(true);
  });

  // Rolling audit v4 H6-P1-2: the picture was flattened at the material height
  // alone, so a box with its own height area was drawn off.
  it('flattens the picture with the height areas set now, and keeps them with it', async () => {
    goLive();
    head = { x: 80, y: 220, z: 0 };
    const box = { id: 'box', x: 80, y: 210, width: 15, height: 15, surfaceHeightMm: 20 };
    useCameraStore.setState({ surfaceHeightMm: 3, heightAreas: [box] });
    useLaserStore.setState({
      connection: { kind: 'connected' } as typeof initialLaser.connection,
      motionOperation: null,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 80, y: 220, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
    });
    const grey = {
      data: new Uint8ClampedArray(1280 * 720 * 4).fill(128),
      width: 1280,
      height: 720,
    };
    vi.mocked(captureSourceFrame).mockResolvedValue(grey);
    await captureWithHeadCamera({ kind: 'here' });
    expect(useCameraStore.getState().bedPicture).toMatchObject({
      surfaceHeightMm: 3,
      heightAreas: [box],
    });
  });

  // Rolling audit v4 H6-P2-1: the calibration holds only at the Z it was taken at.
  it('refuses to capture while the head is away from the Z it was calibrated at', async () => {
    goLive();
    const project = useStore.getState().project;
    const calibratedAtZ = {
      ...onHead,
      mount: {
        kind: 'head' as const,
        headAtCalibrationMm: { x: 200, y: 150 },
        headZAtCalibrationMm: 10,
      },
    };
    useStore.setState({
      project: { ...project, device: { ...project.device, cameraModel: calibratedAtZ } },
    });
    // After autofocus on a 6 mm sheet the head stands 6 mm away from where it was.
    head = { x: 80, y: 220, z: 16 };
    await captureWithHeadCamera({ kind: 'here' });
    expect(useHeadCaptureStore.getState().state).toEqual({
      kind: 'failed',
      message:
        'The head is at machine Z 16.00 mm, but this camera was calibrated with it at Z 10.00 mm, so its picture would not line up with the burn. Move Z back to 10.00 mm, or calibrate the camera again at this height.',
    });
    expect(captureSourceFrame).not.toHaveBeenCalled();
  });

  // Rolling audit 12-P2-3. Each capture move is "the same beam-off jog as
  // Move laser here" (ADR-449 §4), which on stock GRBL with hard limits stops
  // $27 short of the homing switch (ADR-375): homing rests the head the
  // pull-off inside the switch, and driving back onto it can trip ALARM:1
  // (gnea/grbl limits.c L366-L384). With $23=0 on a front-left bed the
  // switches sit at the back-right corner, native (0, 0). A camera 40 mm left
  // of and 37 mm in front of the beam needs the head right on that corner to
  // see it; the stop used to aim exactly there.
  it('keeps capture stops the pull-off clear of the homing switch, and settles there', async () => {
    goLive();
    const project = useStore.getState().project;
    const device: DeviceProfile = {
      ...project.device,
      origin: 'front-left',
      homing: { ...project.device.homing, enabled: true },
      cameraModel: {
        ...onHead,
        pose: lookAt([160, 187, -70], [160, 187.001, 0]),
      },
    };
    useStore.setState({ project: { ...project, device } });
    const evidence = stockNativeEvidence(device, false, 0);
    const jogs: Vec2[] = [];
    useLaserStore.setState({
      ...evidence,
      controllerSettings: {
        ...evidence.controllerSettings,
        hardLimitsEnabled: true,
        homingPullOffMm: 2,
      },
      connection: { kind: 'connected' } as typeof initialLaser.connection,
      streamer: null,
      motionOperation: null,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: null,
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      jogToMachinePosition: vi.fn(async (x: number, y: number) => {
        jogs.push({ x, y });
        // The head arrives where it was sent.
        const frame = resolveNativeBedFrame(device, useLaserStore.getState());
        if (frame !== null) head = toSceneCoords(nativePointToBed({ x, y }, frame), device);
      }),
    });
    head = { x: 200, y: 150 };
    vi.mocked(captureSourceFrame).mockResolvedValue({
      data: new Uint8ClampedArray(1280 * 720 * 4).fill(128),
      width: 1280,
      height: 720,
    });

    await captureWithHeadCamera({ kind: 'area', area: { x: 330, y: 0, width: 70, height: 40 } });

    const laser = useLaserStore.getState();
    const frame = resolveNativeBedFrame(device, laser);
    const limits = frame === null ? null : resolveManualMotionLimits(frame, laser);
    expect(limits).not.toBeNull();
    if (limits === null) return;
    expect(limits.maxX).toBeLessThanOrEqual(-2);
    expect(limits.maxY).toBeLessThanOrEqual(-2);
    expect(jogs.length).toBeGreaterThan(0);
    for (const jog of jogs) {
      expect(jog.x).toBeLessThanOrEqual(limits.maxX);
      expect(jog.y).toBeLessThanOrEqual(limits.maxY);
    }
    // The corner stop goes exactly as far as Move laser here would.
    expect(Math.max(...jogs.map((jog) => jog.x))).toBe(limits.maxX);
    expect(Math.max(...jogs.map((jog) => jog.y))).toBe(limits.maxY);
    // It waited for the head where it was sent, not at the unreachable edge.
    expect(useHeadCaptureStore.getState().state).toEqual({
      kind: 'finished',
      note: 'The head cannot travel far enough for the camera to see the edge of this area, so the picture stops short of it.',
    });
  });
});
