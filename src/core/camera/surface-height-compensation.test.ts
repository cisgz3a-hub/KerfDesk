import { describe, expect, it } from 'vitest';
import type { CameraAlignment } from './camera-alignment';
import type { CameraCalibration } from './camera-calibration';
import { applyHomography, type Mat3 } from './homography';
import { invertMat3, multiplyMat3 } from './mat3';
import { rodriguesToMatrix } from './rodrigues';
import { compensateAlignmentForSurfaceHeight } from './surface-height-compensation';

const K: Mat3 = [800, 0, 640, 0, 820, 360, 0, 0, 1];
const ROTATION = rodriguesToMatrix([0.18, -0.12, 0.04]);
const TRANSLATION = [-210, -165, 760] as const;
const CALIBRATION: CameraCalibration = {
  intrinsics: { fx: 800, fy: 820, cx: 640, cy: 360 },
  distortion: [0, 0, 0, 0],
  imageWidth: 1280,
  imageHeight: 720,
  rmsPx: 0.2,
  calibratedAt: 1,
};

describe('compensateAlignmentForSurfaceHeight', () => {
  it('maps pixels on an elevated parallel surface back to their true machine XY', () => {
    const alignmentHeight = 3;
    const targetHeight = 18;
    const alignment = alignmentAtHeight(alignmentHeight);
    const result = compensateAlignmentForSurfaceHeight({
      alignment,
      calibration: CALIBRATION,
      surfaceHeightMm: targetHeight,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const point of [
      { x: 20, y: 30 },
      { x: 200, y: 160 },
      { x: 380, y: 350 },
    ]) {
      const pixel = projectWorldPoint(point.x, point.y, targetHeight);
      const recovered = applyHomography(result.homography, pixel);
      expect(recovered.x).toBeCloseTo(point.x, 7);
      expect(recovered.y).toBeCloseTo(point.y, 7);
    }
  });

  it('leaves the homography unchanged on the alignment plane', () => {
    const alignment = alignmentAtHeight(3);
    expect(
      compensateAlignmentForSurfaceHeight({
        alignment,
        calibration: undefined,
        surfaceHeightMm: 3,
      }),
    ).toEqual({ ok: true, homography: alignment.homography, adjusted: false });
  });

  it('refuses unsafe height changes without bound height, calibration, or rectified pixels', () => {
    const alignment = alignmentAtHeight(0);
    const { planeHeightMm: _planeHeightMm, ...legacyAlignment } = alignment;
    expect(
      compensateAlignmentForSurfaceHeight({
        alignment: legacyAlignment,
        calibration: CALIBRATION,
        surfaceHeightMm: 2,
      }),
    ).toEqual({ ok: false, reason: 'alignment-height-unknown' });
    expect(
      compensateAlignmentForSurfaceHeight({
        alignment,
        calibration: undefined,
        surfaceHeightMm: 2,
      }),
    ).toEqual({ ok: false, reason: 'needs-lens-calibration' });
    expect(
      compensateAlignmentForSurfaceHeight({
        alignment: { ...alignment, basis: 'raw' },
        calibration: CALIBRATION,
        surfaceHeightMm: 2,
      }),
    ).toEqual({ ok: false, reason: 'needs-rectified-alignment' });
  });
});

function alignmentAtHeight(height: number): CameraAlignment {
  const bedToPixel = projectionForHeight(height);
  const homography = invertMat3(bedToPixel);
  if (homography === null) throw new Error('synthetic projection was singular');
  return {
    homography,
    frameWidth: 1280,
    frameHeight: 720,
    basis: 'rectified',
    alignedAt: 1,
    planeHeightMm: height,
  };
}

function projectionForHeight(height: number): Mat3 {
  const third = [
    TRANSLATION[0] + ROTATION[2] * height,
    TRANSLATION[1] + ROTATION[5] * height,
    TRANSLATION[2] + ROTATION[8] * height,
  ] as const;
  return multiplyMat3(K, [
    ROTATION[0],
    ROTATION[1],
    third[0],
    ROTATION[3],
    ROTATION[4],
    third[1],
    ROTATION[6],
    ROTATION[7],
    third[2],
  ]);
}

function projectWorldPoint(x: number, y: number, z: number): { x: number; y: number } {
  const cameraX = ROTATION[0] * x + ROTATION[1] * y + ROTATION[2] * z + TRANSLATION[0];
  const cameraY = ROTATION[3] * x + ROTATION[4] * y + ROTATION[5] * z + TRANSLATION[1];
  const cameraZ = ROTATION[6] * x + ROTATION[7] * y + ROTATION[8] * z + TRANSLATION[2];
  return { x: (800 * cameraX) / cameraZ + 640, y: (820 * cameraY) / cameraZ + 360 };
}
