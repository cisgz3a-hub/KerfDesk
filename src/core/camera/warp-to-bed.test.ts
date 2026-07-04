// Bed-warp harness (ADR-110): the closed loop with auto-alignment — render a
// camera view of the marker bed, solve the alignment from pixels, warp the
// frame top-down, and the markers must sit at their TRUE bed coordinates in
// the warped image.

import { describe, expect, it } from 'vitest';
import { alignMarkerLayout, detectAlignMarkers, solveMarkerAlignment } from './align-markers';
import type { GrayImage } from './corner-subpix';
import type { RgbaImage } from './cpu-rectify';
import { toGrayImage } from './gray';
import { invertMat3 } from './mat3';
import { renderMarkerView } from './marker-render-fixtures';
import { warpFrameToBed } from './warp-to-bed';

const BED = { width: 400, height: 300 };
const LAYOUT = alignMarkerLayout(BED.width, BED.height);
const CAMERA = {
  width: 640,
  height: 480,
  k: { fx: 420, fy: 420, cx: 320, cy: 240 },
  d: [0, 0, 0, 0] as const, // distortion-free: the homography model is exact
  rvec: [0.1, -0.08, 0.15] as const,
  tvec: [-190, -160, 340] as const,
  layout: LAYOUT,
};

function grayToRgba(img: GrayImage): RgbaImage {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0; i < img.width * img.height; i += 1) {
    const v = Math.max(0, Math.min(255, Math.round(img.data[i] ?? 0)));
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
}

describe('invertMat3', () => {
  it('inverts a homography back to identity', () => {
    const h = [0.5, 0.1, 20, -0.05, 0.45, 12, 0.0002, -0.0001, 1] as const;
    const inv = invertMat3(h);
    expect(inv).not.toBeNull();
    if (inv === null) return;
    const identity = [
      h[0] * inv[0] + h[1] * inv[3] + h[2] * inv[6],
      h[0] * inv[1] + h[1] * inv[4] + h[2] * inv[7],
      h[0] * inv[2] + h[1] * inv[5] + h[2] * inv[8],
    ];
    expect(identity[0]).toBeCloseTo(1, 9);
    expect(identity[1]).toBeCloseTo(0, 9);
    expect(identity[2]).toBeCloseTo(0, 9);
  });

  it('returns null for a singular matrix', () => {
    expect(invertMat3([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull();
  });
});

describe('warpFrameToBed', () => {
  it('closed loop: auto-aligned markers land at their true bed coordinates', () => {
    const frame = renderMarkerView(CAMERA);
    const detection = detectAlignMarkers(frame);
    expect(detection.kind).toBe('ok');
    if (detection.kind !== 'ok') return;
    const solved = solveMarkerAlignment(detection, LAYOUT);
    expect(solved.kind).toBe('ok');
    if (solved.kind !== 'ok') return;

    const pixelsPerMm = 2;
    const warped = warpFrameToBed(grayToRgba(frame), {
      bedWidthMm: BED.width,
      bedHeightMm: BED.height,
      pixelsPerMm,
      homography: solved.homography,
    });
    expect(warped.kind).toBe('ok');
    if (warped.kind !== 'ok') return;
    expect(warped.image.width).toBe(BED.width * pixelsPerMm);
    expect(warped.image.height).toBe(BED.height * pixelsPerMm);

    // The warped image is a top-down bed view: detect the markers AGAIN in it
    // and they must sit at layout.targets (scaled by px/mm) to about a pixel.
    const redetected = detectAlignMarkers(toGrayImage(warped.image));
    expect(redetected.kind).toBe('ok');
    if (redetected.kind !== 'ok') return;
    for (let i = 0; i < LAYOUT.targets.length; i += 1) {
      const found = redetected.imagePoints[i];
      const target = LAYOUT.targets[i];
      expect(found).toBeDefined();
      expect(target).toBeDefined();
      if (found === undefined || target === undefined) return;
      const dx = found.x - target.x * pixelsPerMm;
      const dy = found.y - target.y * pixelsPerMm;
      expect(Math.hypot(dx, dy)).toBeLessThan(1.5);
    }
  });

  it('fails typed on a singular homography', () => {
    const frame: RgbaImage = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
    expect(
      warpFrameToBed(frame, {
        bedWidthMm: 10,
        bedHeightMm: 10,
        pixelsPerMm: 1,
        homography: [1, 2, 3, 2, 4, 6, 0, 0, 1],
      }),
    ).toEqual({ kind: 'failed', reason: 'singular-homography' });
  });
});
