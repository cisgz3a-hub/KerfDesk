import type { CncCoordinateRepresentation } from '../cnc/coordinate-representation';
import {
  cncHelicalContourCanEmit,
  cncHelicalContourRepresentedMidSeams,
  cncHelicalContourRepresentedSeams,
  type CncHelicalContourPass,
} from '../job/helical-representation';
import { fmt } from './cnc-grbl-emit-head';
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';

export type PreparedHelicalMotion = {
  readonly first: { readonly x: number; readonly y: number };
  readonly startX: string;
  readonly startY: string;
  readonly startZ: string;
  readonly finalZ: string;
  readonly arcLines: ReadonlyArray<string>;
};

// Each revolution is written as two half-circle arcs, never as one arc that
// ends where it started. Stock GRBL 1.1h rebuilds the arc centre in single
// precision (motion_control.c mc_arc) and only treats a same-point arc as a
// full circle when the computed angle is within ARC_ANGULAR_TRAVEL_EPSILON
// (5e-7 rad, config.h) of zero. At bed coordinates of a few hundred mm the
// float rounding of the centre exceeds that for small helix radii, and GRBL
// then runs the revolution as one straight plunge. A half circle never has
// that ambiguity, so the machine performs the helix the preview shows.
export function prepareHelicalMotion(
  pass: CncHelicalContourPass,
  plunge: number,
): PreparedHelicalMotion | null {
  if (!cncHelicalContourCanEmit(pass)) return null;
  const first = pass.polyline[0];
  if (first === undefined) return null;
  const startX = fmt(pass.start.x);
  const startY = fmt(pass.start.y);
  const seams = cncHelicalContourRepresentedSeams(pass);
  return {
    first,
    startX,
    startY,
    startZ: seams[0]?.text ?? fmt(0),
    finalZ: seams[seams.length - 1]?.text ?? fmt(0),
    arcLines: halfCircleArcLines(pass, seams, { x: startX, y: startY }, plunge),
  };
}

function halfCircleArcLines(
  pass: CncHelicalContourPass,
  seams: ReadonlyArray<CncCoordinateRepresentation>,
  start: { readonly x: string; readonly y: string },
  plunge: number,
): ReadonlyArray<string> {
  const revolutions = Math.max(1, Math.floor(pass.revolutions));
  const midSeams = cncHelicalContourRepresentedMidSeams(pass);
  const direction = pass.clockwise ? 'G2' : 'G3';
  const i = fmt(pass.center.x - pass.start.x);
  const j = fmt(pass.center.y - pass.start.y);
  // The opposite point and the return offsets are derived from the emitted
  // text, so both halves share one exact centre on the controller.
  const oppositeX = fmt(Number(start.x) + 2 * Number(i));
  const oppositeY = fmt(Number(start.y) + 2 * Number(j));
  const returnI = fmt(Number(start.x) + Number(i) - Number(oppositeX));
  const returnJ = fmt(Number(start.y) + Number(j) - Number(oppositeY));
  const feed = formatGcodeFeedMmPerMin(plunge);
  const arcLines: string[] = [];
  for (let revolution = 1; revolution <= revolutions; revolution += 1) {
    const midZ = midSeams[revolution - 1]?.text ?? fmt(0);
    const endZ = seams[revolution]?.text ?? fmt(0);
    arcLines.push(
      `${direction} X${oppositeX} Y${oppositeY} Z${midZ} I${i} J${j} F${feed}`,
      `${direction} X${start.x} Y${start.y} Z${endZ} I${returnI} J${returnJ} F${feed}`,
    );
  }
  return arcLines;
}
