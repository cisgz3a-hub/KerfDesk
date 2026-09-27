import { describe, expect, it } from 'vitest';
import type { CameraCaptureBinding } from '../camera-capture-binding';
import { savedCameraModel } from './model-fixtures';
import {
  cameraModelInUse,
  normalizeOtherCameraModels,
  ownModelFor,
  savedCameraModels,
  savedModelFor,
  withoutSavedCameraModel,
  withSavedCameraModel,
} from './saved-cameras';

const FINGERPRINT = `hmac-sha256:${'a'.repeat(64)}`;

function usb(sourceId: string): CameraCaptureBinding {
  return { version: 1, sourceKind: 'usb', sourceId, width: 1280, height: 720, resizeMode: 'none' };
}

function falcon(queryFingerprint = FINGERPRINT): CameraCaptureBinding {
  return {
    version: 1,
    sourceKind: 'machine-jpeg',
    sourceId: 'http://192.168.10.1:8080/snapshot',
    queryFingerprint,
    width: 1600,
    height: 1200,
    resizeMode: 'unknown',
  };
}

const overhead = savedCameraModel(usb('overhead'));
const builtIn = savedCameraModel(falcon());

describe('saved cameras', () => {
  it('uses the running camera’s own calibration, whichever is newest', () => {
    const profile = { cameraModel: overhead, otherCameraModels: [builtIn] };
    expect(cameraModelInUse(profile, usb('overhead'))).toBe(overhead);
    expect(cameraModelInUse(profile, falcon())).toBe(builtIn);
  });

  it('falls back to the newest for an uncalibrated camera or none running', () => {
    const profile = { cameraModel: overhead, otherCameraModels: [builtIn] };
    expect(cameraModelInUse(profile, usb('lid'))).toBe(overhead);
    expect(cameraModelInUse(profile, null)).toBe(overhead);
    expect(savedModelFor(profile, usb('lid'))).toBeUndefined();
  });

  it('counts an older unrecorded calibration as any camera’s own', () => {
    const legacy = savedCameraModel();
    expect(ownModelFor({ cameraModel: legacy }, usb('overhead'))).toBe(legacy);
    expect(ownModelFor({ cameraModel: overhead }, usb('lid'))).toBeUndefined();
    expect(ownModelFor({ cameraModel: overhead }, usb('overhead'))).toBe(overhead);
  });

  it('tells network cameras apart by their query as well as their address', () => {
    const profile = { cameraModel: builtIn };
    expect(savedModelFor(profile, falcon(`hmac-sha256:${'b'.repeat(64)}`))).toBeUndefined();
  });

  it('keeps other cameras when one is calibrated, and replaces only its own', () => {
    const first = withSavedCameraModel({}, overhead);
    expect(first).toEqual({ cameraModel: overhead, otherCameraModels: undefined });
    const second = withSavedCameraModel(first, builtIn);
    expect(savedCameraModels(second)).toEqual([builtIn, overhead]);
    const again = savedCameraModel(usb('overhead'));
    const third = withSavedCameraModel(second, again);
    expect(savedCameraModels(third)).toEqual([again, builtIn]);
    expect(savedCameraModels(third)[0]).toBe(again);
  });

  it('lets an unbound calibration replace only the newest', () => {
    const unbound = savedCameraModel();
    const saved = withSavedCameraModel(
      { cameraModel: overhead, otherCameraModels: [builtIn] },
      unbound,
    );
    expect(savedCameraModels(saved)).toEqual([unbound, builtIn]);
    // A bound calibration then replaces the unbound one, which no camera selects.
    expect(savedCameraModels(withSavedCameraModel(saved, overhead))).toEqual([overhead, builtIn]);
  });

  it('moves the next newest up when the newest is forgotten', () => {
    const profile = { cameraModel: overhead, otherCameraModels: [builtIn] };
    expect(withoutSavedCameraModel(profile, overhead)).toEqual({
      cameraModel: builtIn,
      otherCameraModels: undefined,
    });
    expect(withoutSavedCameraModel(profile, builtIn)).toEqual({
      cameraModel: overhead,
      otherCameraModels: undefined,
    });
    expect(withoutSavedCameraModel({ cameraModel: overhead }, overhead)).toEqual({
      cameraModel: undefined,
      otherCameraModels: undefined,
    });
  });

  it('drops invalid or unbound entries read from a file', () => {
    const read = normalizeOtherCameraModels([
      JSON.parse(JSON.stringify(builtIn)),
      { version: 2 },
      JSON.parse(JSON.stringify(savedCameraModel())),
    ]);
    expect(read).toEqual([builtIn]);
    expect(normalizeOtherCameraModels([])).toBeUndefined();
    expect(normalizeOtherCameraModels('x')).toBeUndefined();
  });
});
