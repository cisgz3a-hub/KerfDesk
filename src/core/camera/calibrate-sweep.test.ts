import { describe, expect, it } from 'vitest';
import { makeCheckerboard, projectBoard, pseudoNoise } from './calibrate-fixtures';
import { calibrate, type BoardObservation } from './calibrate';
import { calibrateWithFocalSweep } from './calibrate-sweep';
import { projectFisheye } from './fisheye';

// A wide fisheye whose true focal (180 = 0.5625×width) sits far from the
// default 0.7×width seed — the case the sweep exists for.
const K = { fx: 180, fy: 180, cx: 160, cy: 120 };
const D = [-0.18, 0.03, 0, 0] as const;

const POSES = [
  { rvec: [0, 0, 0], tvec: [-44, -27.5, 95] },
  { rvec: [0.45, 0, 0], tvec: [-44, -24, 105] },
  { rvec: [0, -0.45, 0], tvec: [-36, -26, 105] },
  { rvec: [-0.4, 0.15, 0.1], tvec: [-42, -32, 120] },
  { rvec: [0.15, 0.4, 0.5], tvec: [-40, -30, 115] },
  { rvec: [0.3, -0.3, 0], tvec: [-46, -28, 135] },
  { rvec: [-0.2, -0.35, -0.3], tvec: [-40, -26, 85] },
] as const;

// Detection-scale (0.2px) deterministic noise: exact corners would let even a
// stalled run look artificially clean.
function observations(): BoardObservation[] {
  const objectPoints = makeCheckerboard(9, 6, 11);
  return POSES.map((pose, viewIndex) => ({
    objectPoints,
    imagePoints: projectBoard(K, D, pose.rvec, pose.tvec, objectPoints).map((p, i) => ({
      x: p.x + 0.2 * pseudoNoise(viewIndex * 200 + i),
      y: p.y + 0.2 * pseudoNoise(viewIndex * 200 + i + 100),
    })),
  }));
}

// Function-space agreement with the true camera over the observed field —
// the metric that decides whether de-fisheye is usable (parameters trade off
// along the planar-calibration valley; the mapping is what must be right).
function mappingErrorPx(result: ReturnType<typeof calibrate>): number {
  if (result.kind !== 'ok') return Number.POSITIVE_INFINITY;
  let max = 0;
  for (let ri = 1; ri <= 10; ri += 1) {
    const radius = Math.tan((0.55 * ri) / 10);
    for (let ai = 0; ai < 12; ai += 1) {
      const phi = (2 * Math.PI * ai) / 12;
      const a = radius * Math.cos(phi);
      const b = radius * Math.sin(phi);
      const fit = projectFisheye(a, b, result.intrinsics, result.distortion);
      const truth = projectFisheye(a, b, K, D);
      max = Math.max(max, Math.hypot(fit.x - truth.x, fit.y - truth.y));
    }
  }
  return max;
}

describe('calibrateWithFocalSweep', () => {
  it('recovers the camera where a single default-seeded run stalls', { timeout: 40000 }, () => {
    const views = observations();
    const options = {
      initialGuess: { imageWidth: 320, imageHeight: 240 },
      distortionModel: 'k1k2',
      maxIterations: 600,
    } as const;
    const single = calibrate(views, options);
    const swept = calibrateWithFocalSweep(views, options);
    expect(swept.kind).toBe('ok');
    if (swept.kind !== 'ok') return;
    // The sweep must land on a fit whose lens mapping matches the true camera
    // to sub-pixel across the observed field, and never do worse than the
    // single run it replaces.
    expect(mappingErrorPx(swept)).toBeLessThan(1);
    expect(mappingErrorPx(swept)).toBeLessThanOrEqual(mappingErrorPx(single));
    expect(Math.abs(swept.intrinsics.fx - K.fx) / K.fx).toBeLessThan(0.03);
  });

  it('is a single plain run when the caller supplies a measured focal', { timeout: 30000 }, () => {
    const views = observations();
    const options = {
      initialGuess: { imageWidth: 320, imageHeight: 240, fx: 180, fy: 180 },
      distortionModel: 'k1k2',
      maxIterations: 200,
    } as const;
    expect(calibrateWithFocalSweep(views, options)).toEqual(calibrate(views, options));
  });

  it('propagates typed failures', () => {
    expect(
      calibrateWithFocalSweep([], { initialGuess: { imageWidth: 320, imageHeight: 240 } }),
    ).toEqual({
      kind: 'failed',
      reason: 'too-few-views',
    });
  });
});
