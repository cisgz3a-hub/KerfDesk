import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import type { BoardObservation } from './calibrate';
import {
  addCapture,
  canSolve,
  emptySession,
  MIN_CALIBRATION_VIEWS,
  solveSession,
} from './calibration-session';
import { makeCheckerboard, projectBoard } from './calibrate-fixtures';
import type { CameraIntrinsics, FisheyeDistortion } from './fisheye';

const TRUE_K: CameraIntrinsics = { fx: 900, fy: 890, cx: 955, cy: 545 };
const TRUE_D: FisheyeDistortion = [0.08, -0.01, 0.004, -0.0005];
const BOARD = makeCheckerboard(7, 5, 25);
const POSES = [
  { rvec: [0.02, -0.02, 0] as const, tvec: [0, 0, 600] as const },
  { rvec: [0.45, 0, 0] as const, tvec: [10, -5, 640] as const },
  { rvec: [0, 0.5, 0] as const, tvec: [-8, 6, 660] as const },
  { rvec: [0.3, -0.35, 0.2] as const, tvec: [5, 5, 620] as const },
  { rvec: [-0.4, 0.25, -0.15] as const, tvec: [-6, -4, 680] as const },
];

function capture(poseIndex: number): BoardObservation {
  const pose = POSES[poseIndex] ?? POSES[0];
  if (pose === undefined) throw new Error('no pose');
  const imagePoints: Array<Vec2 | null> = projectBoard(
    TRUE_K,
    TRUE_D,
    pose.rvec,
    pose.tvec,
    BOARD,
  ).map((p) => p);
  return { objectPoints: BOARD, imagePoints };
}

describe('calibration-session', () => {
  it('starts empty and collecting', () => {
    expect(emptySession()).toEqual({ kind: 'collecting', captures: [] });
  });

  it('appends captures and gates solving on the minimum view count', () => {
    let session = emptySession();
    for (let i = 0; i < MIN_CALIBRATION_VIEWS - 1; i += 1) {
      session = addCapture(session, capture(i));
      expect(canSolve(session)).toBe(false);
    }
    session = addCapture(session, capture(MIN_CALIBRATION_VIEWS - 1));
    expect(canSolve(session)).toBe(true);
    expect(session.captures).toHaveLength(MIN_CALIBRATION_VIEWS);
  });

  it('solves a full set and attaches a trusted, diverse verdict', () => {
    let session = emptySession();
    for (let i = 0; i < POSES.length; i += 1) session = addCapture(session, capture(i));
    const solved = solveSession(session, {
      initialGuess: { imageWidth: 1920, imageHeight: 1080, fx: 900, fy: 890 },
    });
    expect(solved.kind).toBe('solved');
    if (solved.kind !== 'solved') return;
    expect(solved.trust.kind).toBe('trusted');
    expect(solved.diversity.kind).toBe('ok');
    expect(solved.result.distortion[0]).toBeCloseTo(TRUE_D[0], 3);
  });

  it('reports a failed solve for too few captures', () => {
    const session = addCapture(emptySession(), capture(0));
    const solved = solveSession(session);
    expect(solved.kind).toBe('failed');
    if (solved.kind !== 'failed') return;
    expect(solved.reason).toBe('too-few-views');
  });
});
