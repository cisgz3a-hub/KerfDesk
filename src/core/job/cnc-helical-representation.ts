import {
  cncCoordinateRepresentationMm,
  type CncCoordinateRepresentation,
} from '../cnc/coordinate-representation';
import { circularArcGeometry, sampleCircularArcPoints } from '../geometry/arc-representation';
import type { CncHelicalContourPass } from './job';

type HelicalRepresentationPoint = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/** Exact factual preconditions used by the helical emitter. */
export function cncHelicalContourCanEmit(pass: CncHelicalContourPass): boolean {
  return (
    pass.polyline.length >= 2 &&
    pass.polyline[0] !== undefined &&
    Number.isFinite(pass.startZMm) &&
    Number.isFinite(pass.zMm) &&
    circularArcGeometry({ ...pass, end: pass.start }).kind === 'ok'
  );
}

/** Controller-represented Z at each emitted full-circle helix boundary. */
export function cncHelicalContourRepresentedSeamZs(
  pass: CncHelicalContourPass,
): ReadonlyArray<number> {
  return cncHelicalContourRepresentedSeams(pass).map((seam) => seam.value);
}

/** One exact text/value pair for every emitted full-circle helix boundary. */
export function cncHelicalContourRepresentedSeams(
  pass: CncHelicalContourPass,
): ReadonlyArray<CncCoordinateRepresentation> {
  const revolutions = Math.max(1, Math.floor(pass.revolutions));
  if (!Number.isFinite(revolutions)) {
    return [cncCoordinateRepresentationMm(pass.startZMm), cncCoordinateRepresentationMm(pass.zMm)];
  }
  return Array.from({ length: revolutions + 1 }, (_, index) =>
    cncCoordinateRepresentationMm(
      pass.startZMm + ((pass.zMm - pass.startZMm) * index) / revolutions,
    ),
  );
}

/**
 * Sample the exact multi-revolution descent and final contour that the GRBL
 * emitter outputs. The per-vertex Z profile is shared by preview, material
 * removal, and tiling so none can collapse an N-turn helix to one circle.
 */
export function cncHelicalContourPoints(
  pass: CncHelicalContourPass,
): ReadonlyArray<HelicalRepresentationPoint> {
  if (!cncHelicalContourCanEmit(pass)) return [];
  const circle = sampleCircularArcPoints({ ...pass, end: pass.start });
  const revolutions = Math.max(1, Math.floor(pass.revolutions));
  const seamZs = cncHelicalContourRepresentedSeamZs(pass);
  const points: HelicalRepresentationPoint[] = [];
  for (let revolution = 0; revolution < revolutions; revolution += 1) {
    const fromZ = seamZs[revolution] ?? 0;
    const toZ = seamZs[revolution + 1] ?? fromZ;
    for (let index = 0; index < circle.length; index += 1) {
      const point = circle[index];
      if (point === undefined || (revolution > 0 && index === 0)) continue;
      const progress = index / Math.max(1, circle.length - 1);
      points.push({
        x: point.x,
        y: point.y,
        z: fromZ + (toZ - fromZ) * progress,
      });
    }
  }
  const finalZ = seamZs[seamZs.length - 1] ?? 0;
  points.push(...pass.polyline.map((point) => ({ ...point, z: finalZ })));
  return points;
}
