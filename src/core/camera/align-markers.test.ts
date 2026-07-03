// Auto-alignment harness (ADR-109): marker detection and the solved
// image→bed homography are verified on RENDERED frames — including a camera
// mounted 180° rotated (the origin pair must disambiguate it) and the
// pro pipeline where the frame is de-fisheyed before aligning.

import { describe, expect, it } from 'vitest';
import { alignMarkerLayout, detectAlignMarkers, solveMarkerAlignment } from './align-markers';
import { applyHomography } from './homography';
import { projectBoard } from './calibrate-fixtures';
import { rectifyImage, type RgbaImage } from './cpu-rectify';
import type { GrayImage } from './corner-subpix';
import { undistortPixel } from './fisheye';
import { toGrayImage } from './gray';
import { renderMarkerView, trueMarkerPixels } from './marker-render-fixtures';

const BED = { width: 400, height: 300 };
const LAYOUT = alignMarkerLayout(BED.width, BED.height);
const K = { fx: 420, fy: 420, cx: 320, cy: 240 };
const MILD_D = [-0.03, 0.004, 0, 0] as const;

// Camera looking down at the bed centre from ~330 mm.
const FRONTO = {
  width: 640,
  height: 480,
  k: K,
  d: MILD_D,
  rvec: [0, 0, 0] as const,
  tvec: [-200, -150, 330] as const,
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

function expectPointsMatch(
  detected: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  truth: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  tolerancePx: number,
): void {
  expect(detected).toHaveLength(truth.length);
  for (let i = 0; i < truth.length; i += 1) {
    const d = detected[i];
    const t = truth[i];
    expect(d).toBeDefined();
    expect(t).toBeDefined();
    if (d === undefined || t === undefined) return;
    expect(Math.hypot(d.x - t.x, d.y - t.y)).toBeLessThan(tolerancePx);
  }
}

describe('detectAlignMarkers on rendered frames', () => {
  it('finds all four targets in layout order (fronto camera)', () => {
    const detection = detectAlignMarkers(renderMarkerView(FRONTO));
    expect(detection.kind).toBe('ok');
    if (detection.kind !== 'ok') return;
    expectPointsMatch(detection.imagePoints, trueMarkerPixels(FRONTO), 1.5);
  });

  it('disambiguates a camera mounted 180° rotated', () => {
    const rotated = { ...FRONTO, rvec: [0, 0, Math.PI] as const, tvec: [200, 150, 330] as const };
    const detection = detectAlignMarkers(renderMarkerView(rotated));
    expect(detection.kind).toBe('ok');
    if (detection.kind !== 'ok') return;
    // Labels must still match the layout order even though the image flipped.
    expectPointsMatch(detection.imagePoints, trueMarkerPixels(rotated), 1.5);
  });

  it('handles a tilted camera mount', () => {
    const tilted = {
      ...FRONTO,
      rvec: [0.15, -0.1, 0.05] as const,
      tvec: [-190, -170, 350] as const,
    };
    const detection = detectAlignMarkers(renderMarkerView(tilted));
    expect(detection.kind).toBe('ok');
    if (detection.kind !== 'ok') return;
    expectPointsMatch(detection.imagePoints, trueMarkerPixels(tilted), 1.5);
  });

  it('fails typed on a blank frame', () => {
    const data = new Float32Array(640 * 480).fill(180);
    expect(detectAlignMarkers({ data, width: 640, height: 480 })).toEqual({
      kind: 'failed',
      reason: 'too-few-markers',
    });
  });

  it('fails typed when no unambiguous origin pair exists', () => {
    const detection = detectAlignMarkers(renderMarkerView({ ...FRONTO, omitOriginPair: true }));
    expect(detection.kind).toBe('failed');
  });
});

describe('solveMarkerAlignment', () => {
  it('raw basis: bed positions register to a couple of millimetres', () => {
    const detection = detectAlignMarkers(renderMarkerView(FRONTO));
    if (detection.kind !== 'ok') throw new Error('detection failed');
    const solved = solveMarkerAlignment(detection, LAYOUT);
    expect(solved.kind).toBe('ok');
    if (solved.kind !== 'ok') return;
    // A raw-basis homography is exact at the four targets; residual lens
    // distortion bends the interior slightly — that is WHY the rectified flow
    // below exists. Assert the mild-lens interior error stays small.
    const probe = { x: BED.width / 2, y: BED.height / 2 };
    const probePixel = projectBoard(K, MILD_D, FRONTO.rvec, FRONTO.tvec, [probe])[0];
    expect(probePixel).toBeDefined();
    if (probePixel === undefined) return;
    const mapped = applyHomography(solved.homography, probePixel);
    expect(Math.hypot(mapped.x - probe.x, mapped.y - probe.y)).toBeLessThan(2);
  });

  it('rectified basis: de-fisheyed frames register sub-millimetre bed-wide', () => {
    // A strongly distorted camera; alignment runs on the RECTIFIED frame.
    const fisheye = { ...FRONTO, d: [-0.16, 0.025, 0, 0] as const };
    const raw = renderMarkerView(fisheye);
    const rectified = rectifyImage(grayToRgba(raw), {
      width: fisheye.width,
      height: fisheye.height,
      outputK: K,
      sourceK: K,
      distortion: fisheye.d,
    });
    const detection = detectAlignMarkers(toGrayImage(rectified));
    expect(detection.kind).toBe('ok');
    if (detection.kind !== 'ok') return;
    const solved = solveMarkerAlignment(detection, LAYOUT);
    expect(solved.kind).toBe('ok');
    if (solved.kind !== 'ok') return;
    // Probe positions across the bed: project through the TRUE fisheye
    // camera, undistort into the rectified basis, then map through H.
    const probes = [
      { x: BED.width / 2, y: BED.height / 2 },
      { x: 60, y: 200 },
      { x: 340, y: 80 },
    ];
    for (const probe of probes) {
      const rawPixel = projectBoard(K, fisheye.d, fisheye.rvec, fisheye.tvec, [probe])[0];
      expect(rawPixel).toBeDefined();
      if (rawPixel === undefined) return;
      const rectifiedPixel = rectifiedBasisPixel(rawPixel, fisheye.d);
      const mapped = applyHomography(solved.homography, rectifiedPixel);
      expect(Math.hypot(mapped.x - probe.x, mapped.y - probe.y)).toBeLessThan(0.7);
    }
  });
});

// Map a RAW distorted pixel into the rectified frame's basis (outputK === K):
// undistort to the ray, then project through the pinhole-only K.
function rectifiedBasisPixel(
  rawPixel: { readonly x: number; readonly y: number },
  d: readonly [number, number, number, number],
): { readonly x: number; readonly y: number } {
  const ray = undistortPixel(rawPixel.x, rawPixel.y, K, d);
  return { x: K.fx * ray.x + K.cx, y: K.fy * ray.y + K.cy };
}
