import { beforeEach, describe, expect, it } from 'vitest';
import type { CameraAlignment, CameraCalibration } from '../../core/camera';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const CAMERA_CALIBRATION: CameraCalibration = {
  intrinsics: { fx: 800, fy: 800, cx: 320, cy: 240 },
  distortion: [0, 0, 0, 0],
  imageWidth: 640,
  imageHeight: 480,
  rmsPx: 0.4,
  calibratedAt: 1,
};

const RECTIFIED_ALIGNMENT: CameraAlignment = {
  homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  frameWidth: 640,
  frameHeight: 480,
  basis: 'rectified',
  alignedAt: 1,
};

describe('machine profile store actions', () => {
  beforeEach(() => resetStore());

  it('replaces the active device profile and keeps workspace dimensions in sync', () => {
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });

    useStore.getState().replaceDeviceProfile({
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      name: 'Imported 500x300',
      bedWidth: 500,
      bedHeight: 300,
    });

    const state = useStore.getState();
    expect(state.project.device.name).toBe('Imported 500x300');
    expect(state.project.workspace.width).toBe(500);
    expect(state.project.workspace.height).toBe(300);
    expect(state.dirty).toBe(true);
    expect(state.undoStack).toHaveLength(1);

    state.undo();

    expect(useStore.getState().project.device.name).not.toBe('Imported 500x300');
  });

  it('selects Absolute Coordinates when a homing-capable profile replaces Current Position', () => {
    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'center' } });

    useStore.getState().replaceDeviceProfile({
      ...DEFAULT_DEVICE_PROFILE,
      name: 'Homing laser',
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    });

    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'absolute',
      anchor: 'center',
    });
  });

  it('clamps controlled laser-off travel when max feed is lowered', () => {
    const before = useStore.getState();
    useStore.setState({
      project: {
        ...before.project,
        device: {
          ...before.project.device,
          maxFeed: 1000,
          controlledLaserOffTravelFeedMmPerMin: 800,
        },
      },
    });

    useStore.getState().updateDeviceProfile({ maxFeed: 500 });

    expect(useStore.getState().project.device).toMatchObject({
      maxFeed: 500,
      controlledLaserOffTravelFeedMmPerMin: 500,
    });
  });

  it('invalidates rectified alignment with calibration in one undoable profile update', () => {
    const before = useStore.getState();
    useStore.setState({
      project: {
        ...before.project,
        device: {
          ...before.project.device,
          cameraCalibration: CAMERA_CALIBRATION,
          cameraAlignment: RECTIFIED_ALIGNMENT,
        },
      },
      undoStack: [],
    });

    useStore.getState().updateDeviceProfile({
      cameraCalibration: { ...CAMERA_CALIBRATION, calibratedAt: 2 },
    });

    const updated = useStore.getState();
    expect(updated.project.device.cameraCalibration?.calibratedAt).toBe(2);
    expect(updated.project.device.cameraAlignment).toBeUndefined();
    expect(updated.undoStack).toHaveLength(1);

    updated.undo();

    expect(useStore.getState().project.device.cameraCalibration).toEqual(CAMERA_CALIBRATION);
    expect(useStore.getState().project.device.cameraAlignment).toEqual(RECTIFIED_ALIGNMENT);
  });
});
