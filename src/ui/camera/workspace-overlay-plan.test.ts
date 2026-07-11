import { describe, expect, it } from 'vitest';
import type { CameraAlignment, CameraCalibration, RgbaImage } from '../../core/camera';
import { resolveWorkspaceOverlay } from './workspace-overlay-plan';

function alignment(basis: 'raw' | 'rectified'): CameraAlignment {
  return {
    homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    frameWidth: 8,
    frameHeight: 8,
    basis,
    alignedAt: 0,
  };
}

const CALIBRATION: CameraCalibration = {
  intrinsics: { fx: 6, fy: 6, cx: 4, cy: 4 },
  distortion: [0.3, -0.05, 0.01, -0.002],
  imageWidth: 8,
  imageHeight: 8,
  rmsPx: 0.3,
  calibratedAt: 0,
};

function still(): RgbaImage {
  return { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(200) };
}

describe('resolveWorkspaceOverlay (R2)', () => {
  it('draws the raw still as-is for a raw-basis alignment', () => {
    const s = still();
    const plan = resolveWorkspaceOverlay({
      still: s,
      hasLiveStream: false,
      alignment: alignment('raw'),
      calibration: undefined,
    });
    expect(plan).toEqual({ kind: 'still', frame: s });
  });

  it('de-fisheyes the still for a rectified-basis alignment with calibration', () => {
    const s = still();
    const plan = resolveWorkspaceOverlay({
      still: s,
      hasLiveStream: false,
      alignment: alignment('rectified'),
      calibration: CALIBRATION,
    });
    expect(plan.kind).toBe('still');
    // A rectified copy, not the raw still.
    if (plan.kind === 'still') expect(plan.frame).not.toBe(s);
  });

  it('refuses a still with a rectified alignment but no calibration', () => {
    expect(
      resolveWorkspaceOverlay({
        still: still(),
        hasLiveStream: false,
        alignment: alignment('rectified'),
        calibration: undefined,
      }).kind,
    ).toBe('basis-mismatch');
  });

  it('draws the live overlay only for a raw-basis alignment', () => {
    expect(
      resolveWorkspaceOverlay({
        still: null,
        hasLiveStream: true,
        alignment: alignment('raw'),
        calibration: undefined,
      }),
    ).toEqual({ kind: 'live' });
  });

  it('refuses the live overlay for a rectified alignment (CSS cannot de-fisheye)', () => {
    expect(
      resolveWorkspaceOverlay({
        still: null,
        hasLiveStream: true,
        alignment: alignment('rectified'),
        calibration: CALIBRATION,
      }).kind,
    ).toBe('basis-mismatch');
  });

  it('draws nothing with no still and no live stream', () => {
    expect(
      resolveWorkspaceOverlay({
        still: null,
        hasLiveStream: false,
        alignment: alignment('raw'),
        calibration: undefined,
      }),
    ).toEqual({ kind: 'none' });
  });
});
