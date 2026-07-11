import { describe, expect, it } from 'vitest';
import type { CameraAlignment } from './camera-alignment';
import type { CameraCalibration } from './camera-calibration';
import type { RgbaImage } from './cpu-rectify';
import { rectifyForAlignmentBasis } from './rectify-for-alignment';

const IDENTITY_H = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;

function alignment(basis: 'raw' | 'rectified'): CameraAlignment {
  return {
    homography: [...IDENTITY_H],
    frameWidth: 8,
    frameHeight: 8,
    basis,
    alignedAt: 0,
  };
}

// Non-zero distortion so rectify actually moves pixels (a bowed test frame).
const CALIBRATION: CameraCalibration = {
  intrinsics: { fx: 6, fy: 6, cx: 4, cy: 4 },
  distortion: [0.3, -0.05, 0.01, -0.002],
  imageWidth: 8,
  imageHeight: 8,
  rmsPx: 0.3,
  calibratedAt: 0,
};

function frame(): RgbaImage {
  // 8×8 checker so a de-fisheye visibly changes bytes.
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < 8 * 8; i += 1) {
    const on = ((i % 8) + Math.floor(i / 8)) % 2 === 0 ? 255 : 0;
    data[i * 4] = on;
    data[i * 4 + 1] = on;
    data[i * 4 + 2] = on;
    data[i * 4 + 3] = 255;
  }
  return { width: 8, height: 8, data };
}

describe('rectifyForAlignmentBasis (R2)', () => {
  it('returns the raw frame unchanged for a raw-basis alignment', () => {
    const raw = frame();
    const result = rectifyForAlignmentBasis(raw, alignment('raw'), CALIBRATION);
    expect(result.kind).toBe('ok');
    // Same reference: raw-basis warps raw pixels, no de-fisheye.
    if (result.kind === 'ok') expect(result.frame).toBe(raw);
  });

  it('de-fisheyes the frame for a rectified-basis alignment with calibration', () => {
    const raw = frame();
    const result = rectifyForAlignmentBasis(raw, alignment('rectified'), CALIBRATION);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      // A NEW, rectified buffer (bytes moved), same dimensions.
      expect(result.frame).not.toBe(raw);
      expect(result.frame.width).toBe(8);
      expect(result.frame.height).toBe(8);
      expect(Array.from(result.frame.data)).not.toEqual(Array.from(raw.data));
    }
  });

  it('refuses a rectified-basis alignment when there is no calibration to de-fisheye by', () => {
    expect(rectifyForAlignmentBasis(frame(), alignment('rectified'), undefined).kind).toBe(
      'basis-mismatch',
    );
  });
});
