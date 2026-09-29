import { describe, expect, it } from 'vitest';
import {
  bedPoint,
  pixelToBed,
  projectWorldPoint,
  type CameraPose,
  type LensModel,
} from './camera-model';
import type { ObservedPoint } from './fit-camera-model';
import { fitDeterminedLens, lensFoldsInPicture } from './fit-determined-lens';
import { overheadPose, wideLens } from './model-fixtures';

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

/** Ring centres of a target over `from`..`to` mm, seen by `lens` with pixel noise. */
function rings(lens: LensModel, pose: CameraPose, from: number, to: number, noisePx: number) {
  const random = seeded(11);
  const points: ObservedPoint[] = [];
  for (let y = from; y <= to; y += 40) {
    for (let x = from; x <= to; x += 40) {
      const world = bedPoint(x, y, 3);
      const pixel = projectWorldPoint(lens, pose, world);
      if (pixel === null) continue;
      points.push({
        world,
        pixel: { x: pixel.x + noisePx * gaussian(random), y: pixel.y + noisePx * gaussian(random) },
      });
    }
  }
  return points;
}

const lens = wideLens();
const pose = overheadPose();
const options = { imageWidth: lens.imageWidth, imageHeight: lens.imageHeight };

describe('fitDeterminedLens', () => {
  it('drops lens terms rings in the middle of the bed cannot pin down', () => {
    // The rings of a 300 mm target on a 400 mm bed.
    const fit = fitDeterminedLens([{ points: rings(lens, pose, 60, 340, 0.15) }], {
      ...options,
      distortionTerms: 4,
      principalPointSigmaPx: 0.08 * lens.imageWidth,
    });
    expect(fit.kind).toBe('ok');
    if (fit.kind !== 'ok') return;
    expect(fit.lens.distortion[3]).toBe(0);
    expect(lensFoldsInPicture(fit.lens)).toBe(false);
    // Beyond the rings the model is extrapolated, but stays near the truth.
    for (const [x, y] of [
      [0, 0],
      [400, 0],
      [0, 400],
      [400, 400],
    ] as const) {
      const pixel = projectWorldPoint(lens, pose, bedPoint(x, y, 3));
      const seen = pixelToBed(fit.lens, fit.poses[0] as CameraPose, pixel ?? { x: 0, y: 0 }, 3);
      expect(Math.hypot((seen?.x ?? 0) - x, (seen?.y ?? 0) - y)).toBeLessThan(3);
    }
  });

  it('keeps every term that rings across the whole bed pin down', () => {
    const fit = fitDeterminedLens([{ points: rings(lens, pose, 20, 380, 0) }], {
      ...options,
      distortionTerms: 4,
    });
    expect(fit.kind).toBe('ok');
    if (fit.kind !== 'ok') return;
    lens.distortion.forEach((k, i) => expect(fit.lens.distortion[i]).toBeCloseTo(k, 4));
  });

  it('fails plainly when even one term bends the lens back inside the picture', () => {
    // A lens whose own curve turns back well inside its picture's corners.
    const folding: LensModel = {
      ...lens,
      intrinsics: { fx: 300, fy: 300, cx: 640, cy: 360 },
      distortion: [-0.2, 0, 0, 0],
    };
    const points = rings(folding, pose, 20, 380, 0);
    expect(fitDeterminedLens([{ points }], { ...options, distortionTerms: 4 })).toEqual({
      kind: 'failed',
      reason: 'lens-folds',
    });
  });
});

describe('lensFoldsInPicture', () => {
  it('tells a lens that turns back before the picture corner from one that does not', () => {
    expect(lensFoldsInPicture(lens)).toBe(false);
    expect(lensFoldsInPicture({ ...lens, distortion: [-0.041, 0.046, 0.581, -1.966] })).toBe(true);
  });
});
