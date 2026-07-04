import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { boardPointToCam } from './calibrate-residuals';
import { type CameraIntrinsics, type FisheyeDistortion, projectFisheye } from './fisheye';
import { seedCalibration } from './init-guess';
import type { ViewExtrinsic } from './lm-params';
import { rodriguesToMatrix } from './rodrigues';

const TRUE_K: CameraIntrinsics = { fx: 900, fy: 890, cx: 960, cy: 540 };
const TRUE_D: FisheyeDistortion = [0.05, -0.008, 0.002, -0.0003];
// Nominal focal deliberately ~11% off and principal point a touch off — the seed
// must still land the per-view poses inside the LM basin.
const NOMINAL_K: CameraIntrinsics = { fx: 1000, fy: 1000, cx: 950, cy: 545 };

function grid(cols: number, rows: number, spacing: number): Vec2[] {
  const points: Vec2[] = [];
  const x0 = (-(cols - 1) * spacing) / 2;
  const y0 = (-(rows - 1) * spacing) / 2;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) points.push({ x: x0 + c * spacing, y: y0 + r * spacing });
  }
  return points;
}

const BOARD = grid(5, 4, 25);
const POSES: ViewExtrinsic[] = [
  { rvec: [0.02, -0.02, 0], tvec: [0, 0, 600] },
  { rvec: [0.45, 0, 0], tvec: [10, -5, 640] },
  { rvec: [0, 0.5, 0], tvec: [-8, 6, 660] },
  { rvec: [0.3, -0.35, 0.2], tvec: [5, 5, 620] },
];

function detect(view: ViewExtrinsic): Vec2[] {
  const r = rodriguesToMatrix(view.rvec);
  return BOARD.map((b) => {
    const cam = boardPointToCam(r, view.tvec, b);
    return projectFisheye(cam.x / cam.z, cam.y / cam.z, TRUE_K, TRUE_D);
  });
}

describe('seedCalibration', () => {
  it('seeds per-view rotations near truth and translations in front of the camera', () => {
    const imagePointsPerView = POSES.map(detect);
    const result = seedCalibration({
      boardPoints: BOARD,
      imagePointsPerView,
      nominalIntrinsics: NOMINAL_K,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.guess.intrinsics).toEqual(NOMINAL_K);
    expect(result.guess.distortion).toEqual([0, 0, 0, 0]);
    result.guess.views.forEach((view, i) => {
      const truth = POSES[i];
      if (truth === undefined) return;
      const angleError = Math.hypot(
        view.rvec[0] - truth.rvec[0],
        view.rvec[1] - truth.rvec[1],
        view.rvec[2] - truth.rvec[2],
      );
      expect(angleError).toBeLessThan(0.15);
      expect(view.tvec[2]).toBeGreaterThan(0);
    });
  });

  it('fails as rank-deficient on a collinear board', () => {
    const collinear: Vec2[] = [
      { x: -30, y: 0 },
      { x: -10, y: 0 },
      { x: 10, y: 0 },
      { x: 30, y: 0 },
    ];
    const imagePointsPerView = [collinear.map(() => ({ x: 100, y: 100 }) as Vec2)];
    const result = seedCalibration({
      boardPoints: collinear,
      imagePointsPerView,
      nominalIntrinsics: NOMINAL_K,
    });
    expect(result).toEqual({ kind: 'failed', reason: 'rank-deficient' });
  });

  it('fails when a view has fewer than four detected corners', () => {
    const sparse: Array<Vec2 | null> = BOARD.map((_, i) => (i < 3 ? { x: i, y: i } : null));
    const result = seedCalibration({
      boardPoints: BOARD,
      imagePointsPerView: [sparse],
      nominalIntrinsics: NOMINAL_K,
    });
    expect(result).toEqual({ kind: 'failed', reason: 'rank-deficient' });
  });
});
