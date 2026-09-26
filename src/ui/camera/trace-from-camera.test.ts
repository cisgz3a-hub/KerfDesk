// Decision-logic tests for trace-from-camera. The geometric warp itself is
// proven in core (bed-image); jsdom has no real 2D canvas, so a successful
// warp deterministically ends at the PNG encoder ('encode-failed').

import { describe, expect, it } from 'vitest';
import { overheadPose, wideLens } from '../../core/camera/model/model-fixtures';
import type { RgbaImage } from '../../core/camera/rgba-image';
import { buildCameraTraceImage } from './trace-from-camera';

const lens = wideLens(64);
const FRAME: RgbaImage = {
  data: new Uint8ClampedArray(lens.imageWidth * lens.imageHeight * 4).fill(128),
  width: lens.imageWidth,
  height: lens.imageHeight,
};

describe('buildCameraTraceImage', () => {
  it('fails typed for an empty bed', () => {
    expect(
      buildCameraTraceImage({
        raw: FRAME,
        lens,
        pose: overheadPose(),
        bedWidthMm: 0,
        bedHeightMm: 10,
        surfaceHeightMm: 0,
      }),
    ).toEqual({ kind: 'failed', reason: 'warp-failed' });
  });

  it('flows a frame through the warp to the encoder', () => {
    const result = buildCameraTraceImage({
      raw: FRAME,
      lens,
      pose: overheadPose(),
      bedWidthMm: 10,
      bedHeightMm: 10,
      surfaceHeightMm: 3,
    });
    // jsdom cannot PNG-encode; in a real browser this is kind 'ok'.
    expect(result).toEqual({ kind: 'failed', reason: 'encode-failed' });
  });
});
