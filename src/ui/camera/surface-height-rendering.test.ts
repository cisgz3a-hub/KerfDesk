import { describe, expect, it, vi } from 'vitest';
import type { CameraAlignment, CameraCalibration, RgbaImage } from '../../core/camera';
import { overlayMatrix3d } from './camera-overlay-transform';
import { resolveCameraSurfaceHeight } from './camera-surface-height';
import { buildCameraTraceImage } from './trace-from-camera';

vi.mock('./png-encode', () => ({ rgbaToPngDataUrl: () => 'data:image/png;base64,fixture' }));

const ALIGNMENT: CameraAlignment = {
  homography: [1, 0, -32, 0, 1, -32, 0, 0, 1],
  frameWidth: 64,
  frameHeight: 64,
  basis: 'rectified',
  planeHeightMm: 0,
  alignedAt: 1,
};
const CALIBRATION: CameraCalibration = {
  intrinsics: { fx: 1000, fy: 1000, cx: 32, cy: 32 },
  distortion: [0, 0, 0, 0],
  imageWidth: 64,
  imageHeight: 64,
  rmsPx: 0,
  calibratedAt: 1,
};

describe('physical surface height through camera consumers', () => {
  it('places the elevated camera feature at the same scene XY on the overlay', () => {
    const surface = resolveCameraSurfaceHeight(ALIGNMENT, CALIBRATION, 200);
    expect(surface.ok).toBe(true);
    if (!surface.ok) return;
    const matrix = overlayMatrix3d(surface.homography, { scale: 2, offsetX: 10, offsetY: 20 });
    // A 1000 mm overhead pinhole camera sees (8,6) on a 200 mm top at this pixel.
    const u = 32 + (1000 * 8) / 800;
    const v = 32 + (1000 * 6) / 800;
    const w = matrix[3] * u + matrix[7] * v + matrix[15];
    expect((matrix[0] * u + matrix[4] * v + matrix[12]) / w).toBeCloseTo(10 + 2 * 8, 8);
    expect((matrix[1] * u + matrix[5] * v + matrix[13]) / w).toBeCloseTo(20 + 2 * 6, 8);
  });

  it('samples the elevated physical pixel through the actual camera trace warp', () => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let y = 0; y < 64; y += 1)
      for (let x = 0; x < 64; x += 1) {
        const offset = (y * 64 + x) * 4;
        data.set([x + 2 * y, x + 2 * y, x + 2 * y, 255], offset);
      }
    const raw: RgbaImage = { width: 64, height: 64, data };
    const trace = buildCameraTraceImage({
      raw,
      alignment: ALIGNMENT,
      calibration: CALIBRATION,
      bedWidthMm: 16,
      bedHeightMm: 12,
      surfaceHeightMm: 200,
    });
    expect(trace.kind).toBe('ok');
    if (trace.kind !== 'ok') return;
    const luma = atob(trace.source.lumaBase64 ?? '');
    // Output pixel center (7.875,5.875) at 4 px/mm maps through the physical
    // camera distance 1000-200. Tiny near-axis lens rectification is <1 LSB.
    const sourceX = 32 + (1000 * 7.875) / 800;
    const sourceY = 32 + (1000 * 5.875) / 800;
    expect(luma.charCodeAt(23 * 64 + 31)).toBeCloseTo(Math.round(sourceX + 2 * sourceY), 0);
  });
});
