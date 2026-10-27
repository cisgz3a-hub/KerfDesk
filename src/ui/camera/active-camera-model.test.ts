// A camera on the laser head is placed where the head is (ADR-449): the
// model in use follows the head, stays the same object while the head stays
// put, and is not usable while the head position is unknown, or while the
// head is away from the Z it was calibrated at (Amendment 2, rolling audit v4
// H6-P2-1).

import { describe, expect, it } from 'vitest';
import { cameraCentre } from '../../core/camera/model/camera-model';
import type { CameraModelRecord } from '../../core/camera/model/camera-model-record';
import { savedCameraModel } from '../../core/camera/model/model-fixtures';
import { activeCameraModel, ownCameraModel } from './active-camera-model';

const fixed = savedCameraModel();
const onHead: CameraModelRecord = {
  ...savedCameraModel(),
  mount: { kind: 'head', headAtCalibrationMm: { x: 100, y: 100 } },
};
const idle = { kind: 'idle' } as const;

describe('activeCameraModel for a camera on the head', () => {
  it('moves the camera with the head', () => {
    const placed = activeCameraModel({ cameraModel: onHead }, idle, { x: 130, y: 90, z: 0 });
    const before = cameraCentre(onHead.pose);
    const after = cameraCentre(placed?.pose ?? onHead.pose);
    expect(after.x - before.x).toBeCloseTo(30, 9);
    expect(after.y - before.y).toBeCloseTo(-10, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
    expect(placed?.mount).toEqual({ kind: 'head', headAtCalibrationMm: { x: 130, y: 90 } });
  });

  it('gives the same model while the head stays put, and a new one when it moves', () => {
    const first = activeCameraModel({ cameraModel: onHead }, idle, { x: 130, y: 90, z: 0 });
    expect(activeCameraModel({ cameraModel: onHead }, idle, { x: 130, y: 90, z: 0 })).toBe(first);
    expect(activeCameraModel({ cameraModel: onHead }, idle, { x: 131, y: 90, z: 0 })).not.toBe(
      first,
    );
  });

  it('is not usable while the head position is unknown', () => {
    expect(activeCameraModel({ cameraModel: onHead }, idle, null)).toBeUndefined();
    // The panel still knows the running camera is calibrated, to say what is missing.
    expect(ownCameraModel({ cameraModel: onHead }, idle)).toBe(onHead);
  });

  it('is not usable while the head is away from the Z it was calibrated at', () => {
    const atZ: CameraModelRecord = {
      ...onHead,
      mount: { kind: 'head', headAtCalibrationMm: { x: 100, y: 100 }, headZAtCalibrationMm: 10 },
    };
    const device = { cameraModel: atZ };
    expect(activeCameraModel(device, idle, { x: 130, y: 90, z: 10.1 })?.mount).toEqual({
      kind: 'head',
      headAtCalibrationMm: { x: 130, y: 90 },
      headZAtCalibrationMm: 10,
    });
    // Autofocus on a 6 mm sheet moved the head 6 mm.
    expect(activeCameraModel(device, idle, { x: 130, y: 90, z: 16 })).toBeUndefined();
    expect(activeCameraModel(device, idle, { x: 130, y: 90, z: 10 })).toBeDefined();
    // A calibration saved before Z was recorded is used at any Z, as before.
    expect(
      activeCameraModel({ cameraModel: onHead }, idle, { x: 130, y: 90, z: 16 }),
    ).toBeDefined();
  });

  it('leaves a fixed camera where it was calibrated', () => {
    expect(activeCameraModel({ cameraModel: fixed }, idle, { x: 130, y: 90, z: 6 })).toBe(fixed);
    expect(activeCameraModel({ cameraModel: fixed }, idle, null)).toBe(fixed);
  });
});
