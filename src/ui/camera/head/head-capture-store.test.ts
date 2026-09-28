// The head camera's capture from the Camera panel (ADR-449): what it asks for
// before it can capture, and Capture here turning one picture into a
// top-down picture on the canvas where the head is.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import type { LensModel } from '../../../core/camera/model/camera-model';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import { lookAt, savedCameraModel } from '../../../core/camera/model/model-fixtures';
import type { Vec2 } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import type * as FrameSource from '../frame-source';
import { captureSourceFrame } from '../frame-source';
import {
  captureWithHeadCamera,
  HEAD_POSITION_UNKNOWN,
  useHeadCaptureStore,
} from './head-capture-store';

let head: Vec2 | null = null;
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
});
