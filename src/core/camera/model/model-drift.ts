// How far a saved camera model is off on a new photo of the engraved target
// (ADR-441 Amendment 1). Every ring the new photo found is mapped through the
// saved model to the bed and compared with where the laser engraved it: a
// camera that was knocked, or a lid that sits differently, shows up as a
// shift of every ring, measured on the bed in millimetres. Pure core.

import { pixelToBed, type CameraPose, type LensModel } from './camera-model';

export type PhotographedMark = {
  readonly x: number;
  readonly y: number;
  readonly pixel: { readonly x: number; readonly y: number };
  /** Left out of the new fit as a mis-detection; not a fair test of the old one. */
  readonly rejected: boolean;
};

export type ModelDrift = {
  readonly rmsMm: number;
  readonly maxMm: number;
  /** The average shift of the rings, mm: a moved camera shifts them all one way. */
  readonly meanDxMm: number;
  readonly meanDyMm: number;
  readonly marks: number;
};

/** The saved model's error on the photographed rings, or null with none to test. */
export function modelDriftOnMarks(
  lens: LensModel,
  pose: CameraPose,
  marks: ReadonlyArray<PhotographedMark>,
  surfaceHeightMm: number,
): ModelDrift | null {
  let count = 0;
  let sumSquares = 0;
  let max = 0;
  let sumDx = 0;
  let sumDy = 0;
  for (const mark of marks) {
    if (mark.rejected) continue;
    const seen = pixelToBed(lens, pose, mark.pixel, surfaceHeightMm);
    if (seen === null) continue;
    const dx = seen.x - mark.x;
    const dy = seen.y - mark.y;
    const error = Math.hypot(dx, dy);
    count += 1;
    sumSquares += error * error;
    max = Math.max(max, error);
    sumDx += dx;
    sumDy += dy;
  }
  if (count === 0) return null;
  return {
    rmsMm: Math.sqrt(sumSquares / count),
    maxMm: max,
    meanDxMm: sumDx / count,
    meanDyMm: sumDy / count,
    marks: count,
  };
}
