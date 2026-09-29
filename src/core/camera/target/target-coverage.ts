// What a saved calibration's engraved target covers of what the camera sees
// (ADR-441 Amendment 4). The accuracy figures are measured on the target's
// rings; everywhere else the picture is extrapolated from them, which is only
// as good as the lens model is outside the rings. Pure core.

import {
  bedMapper,
  bedPoint,
  pixelToBed,
  projectWorldPoint,
  type CameraPose,
  type LensModel,
  type Vec2,
} from '../model/camera-model';
import type { BedArea } from '../model/camera-model-accuracy';
import type { CameraModelRecord } from '../model/camera-model-record';
import { bedTargetLayout, type BedTargetMark } from './bed-target';
import { missingOuterBand, type MissingOuterBand } from './missing-outer-band';

// Picture samples across and down when measuring what the target covers.
const SAMPLES_ACROSS = 32;
const SAMPLES_DOWN = 18;

/**
 * The rings found look like a target engraved with another layout than the
 * one they were matched to (see missingOuterBand), so every ring may be
 * labelled with the wrong bed position; null when nothing suggests it.
 */
export function targetLayoutMismatch(record: CameraModelRecord): MissingOuterBand | null {
  const { targetArea, marks, targetHeightMm } = record.accuracy;
  if (targetArea === undefined || marks === undefined) return null;
  const layout = bedTargetLayout({ area: targetArea });
  return missingOuterBand(layout, marks, (mark) =>
    ringInPicture(record.lens, record.pose, mark, layout.ringDiameterMm, targetHeightMm),
  );
}

/**
 * The share of what the camera sees of the bed, at the target's height, that
 * lies outside the engraved target, where the model is extrapolated rather
 * than measured. A camera on the head counts its whole picture, since the
 * head carries it anywhere over the bed. Null without a saved target area.
 */
export function shareOutsideTarget(record: CameraModelRecord): number | null {
  const { targetArea: area, targetHeightMm } = record.accuracy;
  if (area === undefined) return null;
  // Every target is laid out centred on the bed, so its margins give the bed.
  const bed: BedArea | null =
    record.mount?.kind === 'head'
      ? null
      : { x: 0, y: 0, width: 2 * area.x + area.width, height: 2 * area.y + area.height };
  const toBed = bedMapper(record.lens, record.pose);
  const { imageWidth, imageHeight } = record.lens;
  let seen = 0;
  let outside = 0;
  for (let j = 0; j < SAMPLES_DOWN; j += 1) {
    for (let i = 0; i < SAMPLES_ACROSS; i += 1) {
      const pixel = {
        x: ((i + 0.5) / SAMPLES_ACROSS) * imageWidth - 0.5,
        y: ((j + 0.5) / SAMPLES_DOWN) * imageHeight - 0.5,
      };
      const point = toBed(pixel, targetHeightMm);
      if (point === null || (bed !== null && !inside(bed, point))) continue;
      seen += 1;
      if (!inside(area, point)) outside += 1;
    }
  }
  return seen === 0 ? null : outside / seen;
}

// The whole ring falls inside the picture, and the pixel maps back to it, so
// a lens that folds back past the picture's corner cannot pretend to see it.
function ringInPicture(
  lens: LensModel,
  pose: CameraPose,
  mark: BedTargetMark,
  diameterMm: number,
  heightMm: number,
): boolean {
  const centre = projectWorldPoint(lens, pose, bedPoint(mark.x, mark.y, heightMm));
  const side = projectWorldPoint(lens, pose, bedPoint(mark.x + diameterMm, mark.y, heightMm));
  if (centre === null || side === null) return false;
  const inset = Math.hypot(side.x - centre.x, side.y - centre.y);
  const inPicture =
    centre.x >= inset &&
    centre.y >= inset &&
    centre.x <= lens.imageWidth - 1 - inset &&
    centre.y <= lens.imageHeight - 1 - inset;
  const back = inPicture ? pixelToBed(lens, pose, centre, heightMm) : null;
  return back !== null && Math.hypot(back.x - mark.x, back.y - mark.y) < diameterMm;
}

function inside(area: BedArea, point: Vec2): boolean {
  return (
    point.x >= area.x &&
    point.x <= area.x + area.width &&
    point.y >= area.y &&
    point.y <= area.y + area.height
  );
}
