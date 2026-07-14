// Decision-logic tests for trace-from-camera. The geometric warp itself is
// proven in core (warp-to-bed closed loop); here we assert the basis rules
// and typed failures. jsdom has no real 2D canvas, so the successful path
// deterministically ends at the PNG encoder ('encode-failed') — reaching it
// proves the basis + warp stages accepted the input.

import { describe, expect, it } from 'vitest';
import type { CameraAlignment, RgbaImage } from '../../core/camera';
import { buildCameraTraceImage } from './trace-from-camera';

const FRAME: RgbaImage = {
  data: new Uint8ClampedArray(8 * 6 * 4).fill(128),
  width: 8,
  height: 6,
};

const RAW_ALIGNMENT: CameraAlignment = {
  homography: [0.05, 0, 0, 0, 0.05, 0, 0, 0, 1],
  frameWidth: 8,
  frameHeight: 6,
  basis: 'raw',
  alignedAt: 0,
  planeHeightMm: 0,
};

describe('buildCameraTraceImage', () => {
  it('fails typed without an alignment', () => {
    expect(
      buildCameraTraceImage({
        raw: FRAME,
        alignment: undefined,
        calibration: undefined,
        bedWidthMm: 10,
        bedHeightMm: 10,
        surfaceHeightMm: 0,
      }),
    ).toEqual({ kind: 'failed', reason: 'no-alignment' });
  });

  it('refuses a rectified-basis alignment without a calibration', () => {
    expect(
      buildCameraTraceImage({
        raw: FRAME,
        alignment: { ...RAW_ALIGNMENT, basis: 'rectified' },
        calibration: undefined,
        bedWidthMm: 10,
        bedHeightMm: 10,
        surfaceHeightMm: 0,
      }),
    ).toEqual({ kind: 'failed', reason: 'basis-mismatch' });
  });

  it('raw basis flows through the warp to the encoder', () => {
    const result = buildCameraTraceImage({
      raw: FRAME,
      alignment: RAW_ALIGNMENT,
      calibration: undefined,
      bedWidthMm: 10,
      bedHeightMm: 10,
      surfaceHeightMm: 0,
    });
    // jsdom cannot PNG-encode; in a real browser this is kind 'ok'.
    expect(result).toEqual({ kind: 'failed', reason: 'encode-failed' });
  });
});
