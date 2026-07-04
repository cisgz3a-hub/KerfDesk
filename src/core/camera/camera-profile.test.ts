import { describe, expect, it } from 'vitest';
import { buildCameraTransforms } from './camera-transform';
import {
  cameraProfileReadiness,
  effectiveCameraSource,
  isCameraProfile,
  normalizeCameraProfile,
  type CameraProfile,
} from './camera-profile';

const alignedCamera: CameraProfile = {
  id: 'bench-camera',
  name: 'Bench camera',
  deviceId: 'webcam-1',
  enabled: true,
  resolution: { width: 800, height: 600 },
  transparency: 0.35,
  alignment: {
    alignedAt: '2026-07-01T12:00:00.000Z',
    points: [
      { image: { x: 100, y: 120 }, machine: { x: 0, y: 0 } },
      { image: { x: 700, y: 100 }, machine: { x: 400, y: 0 } },
      { image: { x: 720, y: 520 }, machine: { x: 400, y: 300 } },
      { image: { x: 80, y: 500 }, machine: { x: 0, y: 300 } },
    ],
  },
};

describe('camera profile and alignment', () => {
  it('maps four calibrated image points to machine coordinates and back', () => {
    const result = buildCameraTransforms(alignedCamera.alignment);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    for (const pair of alignedCamera.alignment?.points ?? []) {
      expectPoint(result.imageToMachine(pair.image), pair.machine);
      expectPoint(result.machineToImage(pair.machine), pair.image);
    }
  });

  it('rejects duplicate or collinear point sets instead of producing a bogus transform', () => {
    expect(
      buildCameraTransforms({
        points: [
          { image: { x: 0, y: 0 }, machine: { x: 0, y: 0 } },
          { image: { x: 100, y: 0 }, machine: { x: 100, y: 0 } },
          { image: { x: 100, y: 0 }, machine: { x: 100, y: 100 } },
          { image: { x: 0, y: 100 }, machine: { x: 0, y: 100 } },
        ],
      }),
    ).toEqual({ kind: 'invalid', reason: 'camera alignment image points are not unique' });

    expect(
      buildCameraTransforms({
        points: [
          { image: { x: 0, y: 0 }, machine: { x: 0, y: 0 } },
          { image: { x: 10, y: 0 }, machine: { x: 10, y: 0 } },
          { image: { x: 20, y: 0 }, machine: { x: 20, y: 0 } },
          { image: { x: 30, y: 0 }, machine: { x: 30, y: 0 } },
        ],
      }).kind,
    ).toBe('invalid');
  });

  it('rejects near-degenerate and high-residual alignment sets', () => {
    expect(
      buildCameraTransforms({
        points: [
          { image: { x: 0, y: 0 }, machine: { x: 0, y: 0 } },
          { image: { x: 1000, y: 0 }, machine: { x: 100, y: 0 } },
          { image: { x: 2000, y: 1 }, machine: { x: 200, y: 0.1 } },
          { image: { x: 3000, y: 1 }, machine: { x: 300, y: 0.1 } },
        ],
      }),
    ).toEqual({ kind: 'invalid', reason: 'camera alignment image points are nearly collinear' });

    expect(
      buildCameraTransforms({
        points: [
          { image: { x: 0, y: 0 }, machine: { x: 0, y: 0 } },
          { image: { x: 1000, y: 0 }, machine: { x: 400, y: 0 } },
          { image: { x: 1000, y: 1000 }, machine: { x: 400, y: 300 } },
          { image: { x: 0, y: 1000 }, machine: { x: 0, y: 300 } },
          { image: { x: 500, y: 500 }, machine: { x: 380, y: 260 } },
        ],
      }),
    ).toEqual({ kind: 'invalid', reason: 'camera alignment residual is too high' });
  });

  it('normalizes optional camera settings and reports readiness', () => {
    const normalized = normalizeCameraProfile({
      ...alignedCamera,
      whiteBalanceKelvin: 12000,
      brightness: -250,
      contrast: 180,
      denoise: 2,
      transparency: 2,
    });

    expect(normalized.whiteBalanceKelvin).toBe(10000);
    expect(normalized.brightness).toBe(-100);
    expect(normalized.contrast).toBe(100);
    expect(normalized.denoise).toBe(0.95);
    expect(normalized.transparency).toBe(1);
    expect(cameraProfileReadiness(normalized)).toEqual({ kind: 'ready' });
  });

  it('validates the persisted camera shape', () => {
    expect(isCameraProfile(alignedCamera)).toBe(true);
    expect(isCameraProfile({ ...alignedCamera, deviceId: '' })).toBe(true);
    expect(isCameraProfile({ ...alignedCamera, resolution: { width: -1, height: 600 } })).toBe(
      false,
    );
    expect(isCameraProfile({ ...alignedCamera, deviceId: 42 })).toBe(false);
    expect(
      isCameraProfile({
        ...alignedCamera,
        alignment: { points: [{ image: { x: 0, y: 0 }, machine: { x: 0, y: 0 } }] },
      }),
    ).toBe(false);
  });

  it('defaults old camera profiles to browser source and validates RTSP sources', () => {
    expect(effectiveCameraSource(alignedCamera)).toEqual({ kind: 'browser' });
    expect(
      isCameraProfile({
        ...alignedCamera,
        source: { kind: 'rtsp', url: 'rtsp://192.168.10.1:8554/' },
      }),
    ).toBe(true);
    expect(
      isCameraProfile({
        ...alignedCamera,
        source: { kind: 'rtsp', url: 'http://192.168.10.1:8080/' },
      }),
    ).toBe(false);
    expect(
      isCameraProfile({
        ...alignedCamera,
        source: { kind: 'rtsp', url: 'rtsp://8.8.8.8/live' },
      }),
    ).toBe(false);
    expect(
      isCameraProfile({
        ...alignedCamera,
        source: { kind: 'rtsp', url: 'rtsp://10.999.1.1/live' },
      }),
    ).toBe(false);
    expect(isCameraProfile({ ...alignedCamera, source: { kind: 'browser' } })).toBe(true);
  });
});

function expectPoint(
  actual: { readonly x: number; readonly y: number },
  expected: {
    readonly x: number;
    readonly y: number;
  },
): void {
  expect(actual.x).toBeCloseTo(expected.x, 4);
  expect(actual.y).toBeCloseTo(expected.y, 4);
}
