import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';
import { headPositionToNative, nativeToHeadPosition } from './head-position-frames';
import { nativeBedFrame } from './native-bed-frame';

const device: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  bedWidth: 400,
  bedHeight: 300,
  origin: 'front-left',
};
// Stock GRBL after homing: native travel is negative space.
const negativeFrame = nativeBedFrame(device, { minX: -400, minY: -300, maxX: 0, maxY: 0 });

describe('headPositionToNative', () => {
  it('maps a canvas point through the origin transform and the native frame', () => {
    // Canvas (100, 50) on a front-left bed is machine (100, 250), native (-300, -50).
    const resolved = headPositionToNative(
      { frame: 'bed', xMm: 100, yMm: 50 },
      { device, nativeFrame: negativeFrame, workOffsetMm: null },
    );
    expect(resolved).toEqual({ kind: 'native', point: { x: -300, y: -50 }, verified: true });
  });

  it('goes where an Absolute job burns the point when the bed mapping is unverified', () => {
    // Absolute preparation without a verified frame keeps native targets equal
    // to machine coordinates, so the head goes to machine (100, 250).
    const resolved = headPositionToNative(
      { frame: 'bed', xMm: 100, yMm: 50 },
      { device, nativeFrame: null, workOffsetMm: { x: 30, y: 40 } },
    );
    expect(resolved).toEqual({ kind: 'native', point: { x: 100, y: 250 }, verified: false });
  });

  it('adds the work offset to origin coordinates without needing homing', () => {
    const resolved = headPositionToNative(
      { frame: 'origin', xMm: 10, yMm: -5 },
      { device, nativeFrame: null, workOffsetMm: { x: 120, y: 80 } },
    );
    expect(resolved).toEqual({ kind: 'native', point: { x: 130, y: 75 }, verified: true });
  });

  it('asks for the work offset when the controller has not reported one', () => {
    const resolved = headPositionToNative(
      { frame: 'origin', xMm: 10, yMm: 5 },
      { device, nativeFrame: negativeFrame, workOffsetMm: null },
    );
    expect(resolved).toEqual({ kind: 'needs-work-offset' });
  });
});

describe('nativeToHeadPosition', () => {
  it('is the exact inverse of headPositionToNative in both frames', () => {
    const context = { device, nativeFrame: negativeFrame, workOffsetMm: { x: -250.5, y: -120 } };
    for (const frame of ['bed', 'origin'] as const) {
      const typed = { frame, xMm: 123.456, yMm: 78.9 };
      const resolved = headPositionToNative(typed, context);
      if (resolved.kind !== 'native') throw new Error('expected a native point');
      expect(nativeToHeadPosition(resolved.point, frame, context)).toEqual(typed);
    }
  });

  it('inverts a centre-origin bed, whose transform is not its own inverse', () => {
    const centre: DeviceProfile = { ...device, origin: 'center' };
    const frame = nativeBedFrame(centre, { minX: 0, minY: 0, maxX: 400, maxY: 300 });
    const context = { device: centre, nativeFrame: frame, workOffsetMm: null };
    const resolved = headPositionToNative({ frame: 'bed', xMm: 50, yMm: 40 }, context);
    if (resolved.kind !== 'native') throw new Error('expected a native point');
    expect(nativeToHeadPosition(resolved.point, 'bed', context)).toEqual({
      frame: 'bed',
      xMm: 50,
      yMm: 40,
    });
  });

  it('reads canvas coordinates without a verified frame and needs a work offset for origin', () => {
    const context = { device, nativeFrame: null, workOffsetMm: null };
    expect(nativeToHeadPosition({ x: 100, y: 250 }, 'bed', context)).toEqual({
      frame: 'bed',
      xMm: 100,
      yMm: 50,
    });
    expect(nativeToHeadPosition({ x: 1, y: 2 }, 'origin', context)).toBeNull();
  });

  it('rounds float noise to the controller precision', () => {
    const context = { device, nativeFrame: null, workOffsetMm: { x: 0.1, y: 0.2 } };
    expect(nativeToHeadPosition({ x: 0.3, y: 0.3 }, 'origin', context)).toEqual({
      frame: 'origin',
      xMm: 0.2,
      yMm: 0.1,
    });
  });
});
