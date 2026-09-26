import { describe, expect, it } from 'vitest';
import { undistortPixel } from '../fisheye';
import { bedPoint, pixelToBed, projectWorldPoint, type CameraPose } from './camera-model';
import { fitCameraModel, type ObservedPoint, type ObservedView } from './fit-camera-model';
import { lookAt, overheadPose, wideLens } from './model-fixtures';
import { fitPlaneHomography, poseFromPlaneHomography } from './plane-pose';

const lens = wideLens();

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
}

/** A 9×6 board with 25 mm squares seen from `pose`, with pixel noise. */
function boardView(pose: CameraPose, noisePx: number, random: () => number): ObservedView {
  const points = [];
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const world = { x: col * 25, y: row * 25, z: 0 };
      const pixel = projectWorldPoint(lens, pose, world);
      if (pixel === null) continue;
      points.push({
        world,
        pixel: { x: pixel.x + noisePx * gaussian(random), y: pixel.y + noisePx * gaussian(random) },
      });
    }
  }
  return { points };
}

// Hand-held board poses: tilted up to ~35° and spread over the frame.
function bedGridPoints(pose: CameraPose, heightMm: number): ObservedPoint[] {
  const points: ObservedPoint[] = [];
  for (let y = 20; y <= 380; y += 40) {
    for (let x = 20; x <= 380; x += 40) {
      const world = bedPoint(x, y, heightMm);
      const pixel = projectWorldPoint(lens, pose, world);
      if (pixel !== null) points.push({ world, pixel });
    }
  }
  return points;
}

const BOARD_POSES: ReadonlyArray<CameraPose> = [
  lookAt([100, 60, -300], [100, 62, 0]),
  lookAt([-150, 80, -280], [110, 60, 0]),
  lookAt([350, 40, -280], [90, 70, 0]),
  lookAt([100, -150, -260], [100, 80, 0]),
  lookAt([90, 280, -260], [110, 50, 0]),
  lookAt([-60, -60, -320], [120, 70, 0]),
  lookAt([260, 220, -300], [80, 50, 0]),
  lookAt([100, 60, -420], [60, 30, 0]),
];

describe('fitCameraModel', () => {
  it('recovers a known wide-angle lens from exact multi-view data', () => {
    const random = seeded(1);
    const views = BOARD_POSES.map((pose) => boardView(pose, 0, random));
    const fit = fitCameraModel(views, {
      imageWidth: lens.imageWidth,
      imageHeight: lens.imageHeight,
    });
    expect(fit.kind).toBe('ok');
    if (fit.kind !== 'ok') return;
    expect(fit.rmsPx).toBeLessThan(1e-3);
    expect(fit.lens.intrinsics.fx).toBeCloseTo(560, 2);
    expect(fit.lens.intrinsics.cx).toBeCloseTo(652, 2);
    expect(fit.lens.intrinsics.cy).toBeCloseTo(355, 2);
  });

  it('predicts the noise-free image to a fraction of a pixel with 0.3 px noise', () => {
    const random = seeded(7);
    const views = BOARD_POSES.map((pose) => boardView(pose, 0.3, random));
    const fit = fitCameraModel(views, {
      imageWidth: lens.imageWidth,
      imageHeight: lens.imageHeight,
    });
    expect(fit.kind).toBe('ok');
    if (fit.kind !== 'ok') return;
    expect(fit.rmsPx).toBeLessThan(0.5);
    let worst = 0;
    BOARD_POSES.forEach((truePose, v) => {
      for (const point of views[v]?.points ?? []) {
        const truth = projectWorldPoint(lens, truePose, point.world);
        const fitted = projectWorldPoint(fit.lens, fit.poses[v] as CameraPose, point.world);
        worst = Math.max(
          worst,
          Math.hypot((truth?.x ?? 0) - (fitted?.x ?? 0), (truth?.y ?? 0) - (fitted?.y ?? 0)),
        );
      }
    });
    // These boards cover the middle of the frame only; the fit is at the
    // least-squares optimum (below the true lens's own cost), so what is left
    // is the noise the data cannot average out.
    expect(worst).toBeLessThan(0.6);
    expect(Math.abs(fit.lens.intrinsics.fx - 560)).toBeLessThan(4 * (fit.lensSigma[0] ?? 1) + 1);
  });

  it('drops a mis-detected point instead of bending the fit around it', () => {
    const random = seeded(3);
    const views = BOARD_POSES.map((pose) => boardView(pose, 0.2, random));
    const first = views[0] as ObservedView;
    const broken = first.points.map((p, i) =>
      i === 10 ? { ...p, pixel: { x: p.pixel.x + 40, y: p.pixel.y - 25 } } : p,
    );
    const fit = fitCameraModel([{ points: broken }, ...views.slice(1)], {
      imageWidth: lens.imageWidth,
      imageHeight: lens.imageHeight,
    });
    expect(fit.kind).toBe('ok');
    if (fit.kind !== 'ok') return;
    expect(fit.droppedPoints).toBe(1);
    expect(Number.isNaN(fit.residualsPx[0]?.[10])).toBe(true);
    expect(fit.rmsPx).toBeLessThan(0.4);
  });

  it('fits only the pose when the lens is known', () => {
    const points = bedGridPoints(overheadPose(), 3);
    const fit = fitCameraModel([{ points }], {
      imageWidth: lens.imageWidth,
      imageHeight: lens.imageHeight,
      fixedLens: lens,
    });
    expect(fit.kind).toBe('ok');
    if (fit.kind !== 'ok') return;
    const probe = points[40] as ObservedPoint;
    const seen = pixelToBed(lens, fit.poses[0] as CameraPose, probe.pixel, 3);
    expect(seen?.x).toBeCloseTo(probe.world.x, 4);
    expect(seen?.y).toBeCloseTo(probe.world.y, 4);
  });

  it('refuses a view with too few points', () => {
    const fit = fitCameraModel([{ points: [] }], { imageWidth: 640, imageHeight: 480 });
    expect(fit).toEqual({ kind: 'failed', reason: 'too-few-points' });
  });
});

describe('plane pose initialisation', () => {
  it('recovers a pose from exact plane-to-ray correspondences', () => {
    const pose = overheadPose();
    const pairs = [];
    for (const [x, y] of [
      [0, 0],
      [400, 0],
      [400, 400],
      [0, 400],
      [200, 150],
      [90, 310],
    ] as const) {
      const pixel = projectWorldPoint(lens, pose, bedPoint(x, y, 2));
      const ray = undistortPixel(pixel?.x ?? 0, pixel?.y ?? 0, lens.intrinsics, lens.distortion);
      pairs.push({ plane: { x, y }, ray });
    }
    const h = fitPlaneHomography(pairs);
    expect(h).not.toBeNull();
    const recovered = poseFromPlaneHomography(h ?? [1, 0, 0, 0, 1, 0, 0, 0, 1], -2);
    expect(recovered?.tvec[0]).toBeCloseTo(pose.tvec[0], 4);
    expect(recovered?.tvec[1]).toBeCloseTo(pose.tvec[1], 4);
    expect(recovered?.tvec[2]).toBeCloseTo(pose.tvec[2], 4);
    expect(recovered?.rvec[0]).toBeCloseTo(pose.rvec[0], 6);
  });
});
