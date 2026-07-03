// The detector's Karpathy harness: frames are RENDERED through the forward
// fisheye model and detection must recover the corners from pixels alone —
// then a five-pose end-to-end run must hand calibrate() observations good
// enough to recover the ground-truth camera. Green here proves the auto-detect
// pipeline on synthetic imagery; it does NOT prove a real Falcon frame detects
// (lighting, blur, sensor noise) — that stays a live-wizard perceptual check.

import { describe, expect, it } from 'vitest';
import {
  type BoardRenderOptions,
  renderCheckerboardView,
  trueCornerPixels,
} from './board-render-fixtures';
import { calibrateWithFocalSweep } from './calibrate-sweep';
import { detectCheckerboard, toBoardObservation } from './detect-checkerboard';
import { type CameraIntrinsics, type FisheyeDistortion, projectFisheye } from './fisheye';
import type { Vec2 } from '../scene';

// A Falcon-class wide fisheye: board corners reach ~0.6 rad of field angle,
// where the theta-polynomial separates cleanly from the focal length. (At
// narrow FOV f and k1 are near-interchangeable and planar calibration cannot
// pin the focal — the ADR-108 v2.e conditioning finding, confirmed here.)
const K = { fx: 180, fy: 180, cx: 160, cy: 120 };
const D = [-0.18, 0.03, 0, 0] as const;
const SPEC = { rows: 6, cols: 9 };
const SPACING_MM = 11;

const BASE: Omit<BoardRenderOptions, 'rvec' | 'tvec'> = {
  width: 320,
  height: 240,
  k: K,
  d: D,
  spec: SPEC,
  spacingMm: SPACING_MM,
};

// Seven poses with genuine rotation AND depth spread. Mild tilts leave the
// focal/depth ambiguity of planar calibration unresolved (the ADR-108 v2.e
// conditioning finding): strong (~26°) tilts and varied stand-off are exactly
// what the wizard's pose-diversity gate pushes the operator toward.
const POSES: ReadonlyArray<{
  readonly rvec: readonly [number, number, number];
  readonly tvec: readonly [number, number, number];
}> = [
  { rvec: [0, 0, 0], tvec: [-44, -27.5, 95] },
  { rvec: [0.45, 0, 0], tvec: [-44, -24, 105] },
  { rvec: [0, -0.45, 0], tvec: [-36, -26, 105] },
  { rvec: [-0.4, 0.15, 0.1], tvec: [-42, -32, 120] },
  { rvec: [0.15, 0.4, 0.5], tvec: [-40, -30, 115] },
  { rvec: [0.3, -0.3, 0], tvec: [-46, -28, 135] },
  { rvec: [-0.2, -0.35, -0.3], tvec: [-40, -26, 85] },
];

// Compare the fitted camera's forward mapping against the true one across the
// field the board data covered (theta up to ~0.55 rad): the metric that
// decides whether rectification is usable, robust to the parameter trade-off.
function mappingDisagreementPx(
  k: CameraIntrinsics,
  d: FisheyeDistortion,
): { readonly max: number; readonly mean: number } {
  const thetaMax = 0.55;
  const radialSteps = 12;
  const angularSteps = 16;
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let ri = 1; ri <= radialSteps; ri += 1) {
    const radius = Math.tan((thetaMax * ri) / radialSteps);
    for (let ai = 0; ai < angularSteps; ai += 1) {
      const phi = (2 * Math.PI * ai) / angularSteps;
      const a = radius * Math.cos(phi);
      const b = radius * Math.sin(phi);
      const fit = projectFisheye(a, b, k, d);
      const truth = projectFisheye(a, b, K, D);
      const dist = Math.hypot(fit.x - truth.x, fit.y - truth.y);
      max = Math.max(max, dist);
      sum += dist;
      count += 1;
    }
  }
  return { max, mean: sum / count };
}

// Greedy bijective match of detected corners to ground truth; returns the
// per-pair distances or null when the sets do not pair 1:1 within `maxPx`.
function matchCorners(
  detected: ReadonlyArray<Vec2>,
  truth: ReadonlyArray<Vec2>,
  maxPx: number,
): number[] | null {
  if (detected.length !== truth.length) return null;
  const used = new Set<number>();
  const distances: number[] = [];
  for (const d of detected) {
    let best = -1;
    let bestDist = maxPx;
    for (let i = 0; i < truth.length; i += 1) {
      if (used.has(i)) continue;
      const t = truth[i];
      if (t === undefined) continue;
      const dist = Math.hypot(d.x - t.x, d.y - t.y);
      if (dist <= bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (best < 0) return null;
    used.add(best);
    distances.push(bestDist);
  }
  return distances;
}

describe('detectCheckerboard on rendered frames', () => {
  it.each(POSES.map((pose, index) => ({ index, ...pose })))(
    'recovers all 54 corners to sub-pixel accuracy (pose %#)',
    ({ rvec, tvec }) => {
      const options = { ...BASE, rvec, tvec };
      const detection = detectCheckerboard(renderCheckerboardView(options), SPEC);
      expect(detection.kind).toBe('ok');
      if (detection.kind !== 'ok') return;
      const distances = matchCorners(detection.corners, trueCornerPixels(options), 1);
      expect(distances).not.toBeNull();
      if (distances === null) return;
      const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
      expect(mean).toBeLessThan(0.4);
    },
  );

  it('still detects under sensor-scale noise', () => {
    const options = {
      ...BASE,
      rvec: [0, 0, 0] as const,
      tvec: [-44, -27.5, 95] as const,
      noiseAmplitude: 6,
    };
    const detection = detectCheckerboard(renderCheckerboardView(options), SPEC);
    expect(detection.kind).toBe('ok');
    if (detection.kind !== 'ok') return;
    const distances = matchCorners(detection.corners, trueCornerPixels(options), 1.5);
    expect(distances).not.toBeNull();
  });

  it('is deterministic', () => {
    const options = { ...BASE, rvec: [0.45, 0, 0] as const, tvec: [-44, -24, 105] as const };
    const frame = renderCheckerboardView(options);
    expect(detectCheckerboard(frame, SPEC)).toEqual(detectCheckerboard(frame, SPEC));
  });

  it('fails typed on a blank frame', () => {
    const data = new Float32Array(320 * 240).fill(128);
    const detection = detectCheckerboard({ data, width: 320, height: 240 }, SPEC);
    expect(detection.kind).toBe('failed');
  });

  it('fails typed when the board is cut off at the frame edge', () => {
    const options = { ...BASE, rvec: [0, 0, 0] as const, tvec: [-150, -27, 70] as const };
    const detection = detectCheckerboard(renderCheckerboardView(options), SPEC);
    expect(detection.kind).toBe('failed');
  });

  it(
    'end-to-end: five detected views calibrate back to the true camera',
    { timeout: 60000 },
    () => {
      const observations = POSES.map((pose) => {
        const options = { ...BASE, ...pose };
        const detection = detectCheckerboard(renderCheckerboardView(options), SPEC);
        expect(detection.kind).toBe('ok');
        if (detection.kind !== 'ok') throw new Error('detection failed');
        return toBoardObservation(detection, SPEC, SPACING_MM);
      });
      // The focal sweep is what the wizard runs (via solveSession): a single
      // default-seeded LM stalls far up the focal↔distortion valley.
      const result = calibrateWithFocalSweep(observations, {
        initialGuess: { imageWidth: 320, imageHeight: 240 },
        distortionModel: 'k1k2',
        maxIterations: 400,
      });
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.rmsPx).toBeLessThan(0.35);
      expect(Math.abs(result.intrinsics.cx - K.cx)).toBeLessThan(3);
      expect(Math.abs(result.intrinsics.cy - K.cy)).toBeLessThan(3);
      // Individual parameters are NOT asserted tightly: on a planar target the
      // focal and k1/k2 trade off along a near-flat valley, so slightly biased
      // detections land at a different point on it. What de-fisheye needs is the
      // fitted MAPPING, so assert function agreement with the true camera.
      const disagreement = mappingDisagreementPx(result.intrinsics, result.distortion);
      expect(disagreement.max).toBeLessThan(1);
      expect(disagreement.mean).toBeLessThan(0.5);
    },
  );
});
