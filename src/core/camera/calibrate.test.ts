import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { type BoardObservation, calibrate } from './calibrate';
import { makeCheckerboard, projectBoard, pseudoNoise } from './calibrate-fixtures';
import type { CameraIntrinsics, FisheyeDistortion } from './fisheye';

// GREEN HERE PROVES the solver recovers a known K/D from clean synthetic geometry —
// it does NOT prove a real Falcon frame de-fisheyes. That is the hardware/perceptual
// gate (ADR-025, the "Apply Calibration?" A/B toggle on a real captured frame).

const TRUE_K: CameraIntrinsics = { fx: 900, fy: 890, cx: 955, cy: 545 };
const TRUE_D: FisheyeDistortion = [0.08, -0.01, 0.004, -0.0005];
const BOARD = makeCheckerboard(7, 5, 25);
// Five distinct tilts break the planar focal/depth ambiguity (ADR-108 needs ~5).
const POSES = [
  { rvec: [0.02, -0.02, 0] as const, tvec: [0, 0, 600] as const },
  { rvec: [0.45, 0, 0] as const, tvec: [10, -5, 640] as const },
  { rvec: [0, 0.5, 0] as const, tvec: [-8, 6, 660] as const },
  { rvec: [0.3, -0.35, 0.2] as const, tvec: [5, 5, 620] as const },
  { rvec: [-0.4, 0.25, -0.15] as const, tvec: [-6, -4, 680] as const },
];
const IMAGE = { imageWidth: 1920, imageHeight: 1080 };

type Pose = {
  readonly rvec: readonly [number, number, number];
  readonly tvec: readonly [number, number, number];
};

function observeBoard(
  board: ReadonlyArray<Vec2>,
  poses: ReadonlyArray<Pose>,
  noisePx = 0,
): BoardObservation[] {
  return poses.map((pose, viewIndex) => {
    const clean = projectBoard(TRUE_K, TRUE_D, pose.rvec, pose.tvec, board);
    const imagePoints: Array<Vec2 | null> = clean.map((p, i) => ({
      x: p.x + noisePx * pseudoNoise(viewIndex * 1000 + i * 2),
      y: p.y + noisePx * pseudoNoise(viewIndex * 1000 + i * 2 + 1),
    }));
    return { objectPoints: board, imagePoints };
  });
}

function observe(noisePx = 0): BoardObservation[] {
  return observeBoard(BOARD, POSES, noisePx);
}

function expectIntrinsicsClose(actual: CameraIntrinsics, expected: CameraIntrinsics): void {
  expect(actual.fx).toBeCloseTo(expected.fx, 3);
  expect(actual.fy).toBeCloseTo(expected.fy, 3);
  expect(actual.cx).toBeCloseTo(expected.cx, 3);
  expect(actual.cy).toBeCloseTo(expected.cy, 3);
}

function expectDistortionClose(actual: FisheyeDistortion, expected: FisheyeDistortion): void {
  expect(actual[0]).toBeCloseTo(expected[0], 5);
  expect(actual[1]).toBeCloseTo(expected[1], 5);
  expect(actual[2]).toBeCloseTo(expected[2], 5);
  expect(actual[3]).toBeCloseTo(expected[3], 4);
}

describe('calibrate — recovery (Karpathy gate)', () => {
  it('recovers K and D to near machine precision from a good init (zero noise)', () => {
    const result = calibrate(observe(0), { initialGuess: { ...IMAGE, fx: 900, fy: 890 } });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expectIntrinsicsClose(result.intrinsics, TRUE_K);
    expectDistortionClose(result.distortion, TRUE_D);
    expect(result.imageWidth).toBe(IMAGE.imageWidth);
    expect(result.imageHeight).toBe(IMAGE.imageHeight);
    expect(result.rmsPx).toBeLessThan(1e-6);
    expect(result.iterations).toBeLessThan(100); // good init converges fast (~25)
  });

  it('crosses the basin of attraction from a wrong-K init (zero noise)', () => {
    const result = calibrate(observe(0), {
      initialGuess: { ...IMAGE, fx: 700, fy: 700, cx: 900, cy: 600 },
      maxIterations: 200,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expectIntrinsicsClose(result.intrinsics, TRUE_K);
    expectDistortionClose(result.distortion, TRUE_D);
    expect(result.rmsPx).toBeLessThan(1e-6);
  });

  it('fits noisy detections without overfitting reprojection to zero', () => {
    const result = calibrate(observe(0.2), {
      initialGuess: { ...IMAGE, fx: 900, fy: 890 },
      maxIterations: 200,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    // The RMS must track the input noise: a near-zero RMS would mean the poses
    // illegally absorbed it. The high-order terms (k3,k4) ARE weakly observed and
    // overfit noise — a documented limitation, so their values are not asserted;
    // robust captures need more poses/points and a coefficient sanity gate (v2.e).
    expect(result.rmsPx).toBeGreaterThan(0.05);
    expect(result.rmsPx).toBeLessThan(0.25);
    expect(Math.abs(result.intrinsics.fx - TRUE_K.fx)).toBeLessThan(2);
    expect(Math.abs(result.intrinsics.fy - TRUE_K.fy)).toBeLessThan(2);
  });

  it("the 'k1k2' model freezes k3 and k4 to exactly zero in the result", () => {
    // The contract of distortionModel:'k1k2' is that the high-order terms cannot move
    // from zero, so 0.2px noise can never blow them up (the v2.c finding). The freeze
    // mechanism is proven rigorously in levmar's fixedIndices tests; this verifies the
    // wiring. Whether k1,k2 are individually well-determined is a conditioning matter
    // the trust check handles, not this feature.
    const result = calibrate(observe(0.2), {
      initialGuess: { ...IMAGE, fx: 900, fy: 890 },
      distortionModel: 'k1k2',
      maxIterations: 30,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.distortion[2]).toBe(0);
    expect(result.distortion[3]).toBe(0);
  });

  it('is deterministic for identical input', () => {
    const options = { initialGuess: { ...IMAGE, fx: 900, fy: 890 } };
    expect(calibrate(observe(0), options)).toEqual(calibrate(observe(0), options));
  });

  it('reports quadrant coverage and per-view RMS for every view', () => {
    const result = calibrate(observe(0), { initialGuess: { ...IMAGE, fx: 900, fy: 890 } });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.perViewRmsPx).toHaveLength(POSES.length);
    expect(result.coverage.map((q) => q.quadrant)).toEqual(['tl', 'tr', 'bl', 'br']);
    const totalCovered = result.coverage.reduce((sum, q) => sum + q.corners, 0);
    expect(totalCovered).toBe(BOARD.length * POSES.length);
  });
});

describe('calibrate — failures', () => {
  it('rejects a single view as too-few-views', () => {
    const single = observe(0).slice(0, 1);
    expect(calibrate(single, { initialGuess: IMAGE })).toEqual({
      kind: 'failed',
      reason: 'too-few-views',
    });
  });

  it('rejects a board with fewer than four points', () => {
    const tinyBoard: Vec2[] = [
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 0, y: 25 },
    ];
    const views = observeBoard(tinyBoard, POSES.slice(0, 2));
    expect(calibrate(views, { initialGuess: IMAGE })).toEqual({
      kind: 'failed',
      reason: 'too-few-points',
    });
  });

  it('rejects a collinear board as rank-deficient', () => {
    const line: Vec2[] = [-30, -20, -10, 10, 20, 30].map((x) => ({ x, y: 0 }));
    const views = observeBoard(line, POSES.slice(0, 2));
    expect(calibrate(views, { initialGuess: IMAGE })).toEqual({
      kind: 'failed',
      reason: 'rank-deficient',
    });
  });

  it('returns a best-effort fit when the iteration budget is too small to converge', () => {
    // OpenCV-aligned: a tight budget yields the partial fit, not a hard failure — the
    // wizard's trust check (not the solver) judges whether it is usable.
    const result = calibrate(observe(0), {
      initialGuess: { ...IMAGE, fx: 700, fy: 700, cx: 900, cy: 600 },
      maxIterations: 2,
    });
    expect(result.kind).toBe('ok');
  });
});
