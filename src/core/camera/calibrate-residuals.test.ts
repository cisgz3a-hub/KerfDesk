import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import {
  boardPointToCam,
  buildActiveMask,
  computeResiduals,
  type ResidualContext,
} from './calibrate-residuals';
import { type CameraIntrinsics, type FisheyeDistortion, projectFisheye } from './fisheye';
import { packParams, type ViewExtrinsic } from './lm-params';
import { rodriguesToMatrix } from './rodrigues';

const K: CameraIntrinsics = { fx: 900, fy: 890, cx: 960, cy: 540 };
const D: FisheyeDistortion = [0.06, -0.008, 0.002, -0.0003];
const BOARD: Vec2[] = [
  { x: -25, y: -25 },
  { x: 25, y: -25 },
  { x: 25, y: 25 },
  { x: -25, y: 25 },
];
const VIEW: ViewExtrinsic = { rvec: [0.2, -0.15, 0.05], tvec: [4, -3, 600] };

// Forward-simulate the detection a perfect camera would record for one board point.
function project(view: ViewExtrinsic, board: Vec2): Vec2 {
  const cam = boardPointToCam(rodriguesToMatrix(view.rvec), view.tvec, board);
  return projectFisheye(cam.x / cam.z, cam.y / cam.z, K, D);
}

describe('boardPointToCam', () => {
  it('translates with the identity rotation', () => {
    const cam = boardPointToCam([1, 0, 0, 0, 1, 0, 0, 0, 1], [10, 20, 500], { x: 3, y: 4 });
    expect(cam).toEqual({ x: 13, y: 24, z: 500 });
  });

  it('reads the first two columns of a rotated matrix (not row 2)', () => {
    // 90deg about z maps board (2,0) -> camera (0,2); a row-vs-column bug would not.
    const r90 = rodriguesToMatrix([0, 0, Math.PI / 2]);
    const cam = boardPointToCam(r90, [0, 0, 100], { x: 2, y: 0 });
    expect(cam.x).toBeCloseTo(0, 9);
    expect(cam.y).toBeCloseTo(2, 9);
    expect(cam.z).toBeCloseTo(100, 9);
  });
});

describe('buildActiveMask', () => {
  it('marks a corner pair inactive exactly where its detection is null', () => {
    const ctx: ResidualContext = {
      boardPoints: BOARD,
      imagePointsPerView: [[{ x: 1, y: 1 }, null, { x: 2, y: 2 }, { x: 3, y: 3 }]],
      numViews: 1,
    };
    expect(buildActiveMask(ctx)).toEqual([true, true, false, false, true, true, true, true]);
  });
});

describe('computeResiduals', () => {
  it('is near-zero when parameters equal the generating ground truth', () => {
    const detections = BOARD.map((b) => project(VIEW, b));
    const ctx: ResidualContext = {
      boardPoints: BOARD,
      imagePointsPerView: [detections],
      numViews: 1,
    };
    const residuals = computeResiduals(packParams(K, D, [VIEW]), ctx, buildActiveMask(ctx));
    for (const r of residuals) expect(Math.abs(r)).toBeLessThan(1e-6);
  });

  it('keeps the residual length at 2·N·V with null and behind-camera corners', () => {
    const detections = BOARD.map((b) => project(VIEW, b));
    const withNull: Array<Vec2 | null> = [
      detections[0] ?? null,
      null,
      detections[2] ?? null,
      detections[3] ?? null,
    ];
    const behind: ViewExtrinsic = { rvec: [0, 0, 0], tvec: [0, 0, -500] };
    const ctx: ResidualContext = {
      boardPoints: BOARD,
      imagePointsPerView: [withNull, BOARD.map(() => ({ x: 0, y: 0 }))],
      numViews: 2,
    };
    const residuals = computeResiduals(packParams(K, D, [VIEW, behind]), ctx, buildActiveMask(ctx));
    expect(residuals).toHaveLength(2 * BOARD.length * 2);
    // The null corner (index 1) contributes a zero pair regardless of geometry.
    expect(residuals[2]).toBe(0);
    expect(residuals[3]).toBe(0);
    // Every corner of the behind-camera view is a zero pair (inactive this eval).
    for (let i = 2 * BOARD.length; i < residuals.length; i += 1) expect(residuals[i]).toBe(0);
  });
});
