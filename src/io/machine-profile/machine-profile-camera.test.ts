import { describe, expect, it } from 'vitest';
import type { CameraAlignment, CameraCalibration, CameraProfile } from '../../core/camera';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
} from './machine-profile-io';

const CALIBRATION: CameraCalibration = {
  intrinsics: { fx: 1200, fy: 1198, cx: 960, cy: 540 },
  distortion: [0.3, -0.05, 0.01, -0.002],
  imageWidth: 1920,
  imageHeight: 1080,
  rmsPx: 0.24,
  calibratedAt: 1_750_000_000_000,
};

const ALIGNMENT: CameraAlignment = {
  homography: [0.25, 0.01, 12, -0.02, 0.24, 8, 0.0001, 0, 1],
  frameWidth: 1920,
  frameHeight: 1080,
  basis: 'rectified',
  alignedAt: 1_750_000_000_001,
};

function profileWithCamera(): DeviceProfile {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    baudRate: 250000,
    cameraCalibration: CALIBRATION,
    cameraAlignment: ALIGNMENT,
    capabilities: [...(DEFAULT_DEVICE_PROFILE.capabilities ?? []), 'camera'],
    cameraProfile: {
      id: 'lid-camera',
      name: 'Lid camera',
      deviceId: 'usb-0',
      enabled: false,
      transparency: 0.4,
      resolution: { width: 1920, height: 1080 },
      lensCalibration: {
        calibratedAt: '2026-07-01T12:00:00.000Z',
        imageSize: { width: 1920, height: 1080 },
        cameraMatrix: { fx: 1200, fy: 1198, cx: 960, cy: 540 },
        distortion: { k1: -0.12, k2: 0.02, p1: 0.001, p2: 0.001, k3: 0 },
        rmsError: 0.24,
        framesUsed: 14,
      },
    },
  };
}

function profileCamera(profile: DeviceProfile): CameraProfile {
  if (profile.cameraProfile === undefined) throw new Error('camera fixture missing profile');
  return profile.cameraProfile;
}

describe('machine profile camera metadata', () => {
  it('roundtrips camera metadata in .lfmachine.json', () => {
    const text = serializeMachineProfileDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: profileWithCamera(),
      source: { kind: 'custom', label: 'Camera bench' },
      reviewNotes: [],
    });

    const result = deserializeMachineProfileDocument(text);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.document.profile.capabilities).toContain('camera');
    const cameraMatrix = result.document.profile.cameraProfile?.lensCalibration?.cameraMatrix;
    expect(cameraMatrix?.fx).toBe(1200);
    expect(result.document.profile.cameraProfile?.transparency).toBe(0.4);
    expect(result.document.profile.baudRate).toBe(250000);
    expect(result.document.profile.cameraCalibration).toEqual(CALIBRATION);
    expect(result.document.profile.cameraAlignment).toEqual(ALIGNMENT);
  });

  it('roundtrips RTSP camera source metadata in .lfmachine.json', () => {
    const profile = profileWithCamera();
    const text = serializeMachineProfileDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: {
        ...profile,
        cameraProfile: {
          ...profileCamera(profile),
          source: { kind: 'rtsp', url: 'rtsp://192.168.10.1:8554/' },
        },
      },
      source: { kind: 'custom', label: 'RTSP camera bench' },
      reviewNotes: [],
    });

    const result = deserializeMachineProfileDocument(text);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.document.profile.cameraProfile?.source).toEqual({
      kind: 'rtsp',
      url: 'rtsp://192.168.10.1:8554/',
    });
  });

  it('rejects malformed camera metadata in imported machine profiles', () => {
    const profile = profileWithCamera();
    const result = deserializeMachineProfileDocument(
      JSON.stringify({
        format: MACHINE_PROFILE_FORMAT,
        schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
        profile: {
          ...profile,
          cameraProfile: { ...profile.cameraProfile, transparency: 2 },
        },
        source: { kind: 'custom', label: 'Bad camera' },
        reviewNotes: [],
      }),
    );

    expect(result).toEqual({ kind: 'invalid', reason: 'profile.cameraProfile is invalid' });
  });
});
