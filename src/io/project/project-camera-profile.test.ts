import { describe, expect, it } from 'vitest';
import type { CameraProfile } from '../../core/camera';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { createProject } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function cameraDevice(): DeviceProfile {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    capabilities: [...(DEFAULT_DEVICE_PROFILE.capabilities ?? []), 'camera'],
    cameraProfile: {
      id: 'bench-camera',
      name: 'Bench camera',
      deviceId: 'webcam-1',
      enabled: true,
      resolution: { width: 1280, height: 720 },
      transparency: 0.25,
      alignment: {
        alignedAt: '2026-07-01T12:00:00.000Z',
        points: [
          { image: { x: 0, y: 0 }, machine: { x: 0, y: 0 } },
          { image: { x: 1280, y: 0 }, machine: { x: 400, y: 0 } },
          { image: { x: 1280, y: 720 }, machine: { x: 400, y: 400 } },
          { image: { x: 0, y: 720 }, machine: { x: 0, y: 400 } },
        ],
      },
    },
  };
}

function cameraProfile(): CameraProfile {
  const profile = cameraDevice().cameraProfile;
  if (profile === undefined) throw new Error('camera fixture missing profile');
  return profile;
}

describe('project camera profile persistence', () => {
  it('roundtrips optional camera profile metadata in .lf2 files', () => {
    const result = deserializeProject(serializeProject(createProject(cameraDevice())));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.capabilities).toContain('camera');
    expect(result.project.device.cameraProfile?.name).toBe('Bench camera');
    expect(result.project.device.cameraProfile?.alignment?.points).toHaveLength(4);
  });

  it('roundtrips RTSP camera source metadata in .lf2 files', () => {
    const device = {
      ...cameraDevice(),
      cameraProfile: {
        ...cameraProfile(),
        source: { kind: 'rtsp' as const, url: 'rtsp://192.168.10.1:8554/' },
      },
    };

    const result = deserializeProject(serializeProject(createProject(device)));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.cameraProfile?.source).toEqual({
      kind: 'rtsp',
      url: 'rtsp://192.168.10.1:8554/',
    });
  });

  it('backfills old projects without a camera profile to undefined', () => {
    const raw = JSON.parse(serializeProject(createProject()));
    delete raw.device.cameraProfile;

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.cameraProfile).toBeUndefined();
  });

  it('rejects malformed camera profile metadata', () => {
    const raw = JSON.parse(serializeProject(createProject(cameraDevice())));
    raw.device.cameraProfile.alignment.points[1].machine.x = 'bad';

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.reason).toMatch(/device\.cameraProfile/);
  });
});
