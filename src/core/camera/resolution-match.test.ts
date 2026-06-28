import { describe, expect, it } from 'vitest';
import type { CameraCalibration } from './camera-calibration';
import { frameMatchesCalibration, scaleIntrinsicsToFrame } from './resolution-match';

const CAL: CameraCalibration = {
  intrinsics: { fx: 900, fy: 890, cx: 960, cy: 540 },
  distortion: [0.08, -0.01, 0.004, -0.0005],
  imageWidth: 1920,
  imageHeight: 1080,
  rmsPx: 0.3,
  calibratedAt: 1782648000000,
};

describe('frameMatchesCalibration', () => {
  it('is true only at the captured resolution', () => {
    expect(frameMatchesCalibration(CAL, 1920, 1080)).toBe(true);
    expect(frameMatchesCalibration(CAL, 1280, 720)).toBe(false);
    expect(frameMatchesCalibration(CAL, 1920, 1081)).toBe(false);
  });
});

describe('scaleIntrinsicsToFrame', () => {
  it('returns the intrinsics unchanged at the captured resolution', () => {
    expect(scaleIntrinsicsToFrame(CAL, 1920, 1080)).toEqual(CAL.intrinsics);
  });

  it('scales fx,cx by the width ratio and fy,cy by the height ratio', () => {
    const scaled = scaleIntrinsicsToFrame(CAL, 960, 540); // half size
    expect(scaled.fx).toBeCloseTo(450, 6);
    expect(scaled.fy).toBeCloseTo(445, 6);
    expect(scaled.cx).toBeCloseTo(480, 6);
    expect(scaled.cy).toBeCloseTo(270, 6);
  });
});
