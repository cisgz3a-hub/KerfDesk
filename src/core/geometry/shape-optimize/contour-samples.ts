// One contour of a path, sampled in world millimetres for Optimize Shapes
// (LBG-T22). Lines keep their own ends; cubics are flattened within the
// sample tolerance after being placed (an affine map moves control points
// exactly); elliptical arcs come densely sampled from the arc fitter's mapping.
// Every joint between two source pieces remembers how sharply the outline
// turns there, from the pieces' exact end tangents, so a drawn corner is found
// where it is, and whether both sides are straight lines (a line-to-line
// vertex may be pixel noise; a joint with a curve on either side never is).

import { mapCurveSubpath, type MappedPiece } from '../arc-fit/mapped-pieces';
import { flattenCubicChords } from '../../scene/curve-flatten';
import type { CurveSubpath, Transform, Vec2 } from '../../scene/scene-object';
import { applyTransform } from '../../scene/transform';

export type ContourJoint = {
  /** Index of the joint's point in `points`. */
  readonly index: number;
  /** How far the outline turns at the joint, radians in [0, π]. */
  readonly turnRad: number;
  /** Both pieces meeting here are straight lines. */
  readonly betweenLines: boolean;
};

export type ContourSamples = {
  /** Distinct points in order; a closed contour does not repeat its first point. */
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
  readonly joints: ReadonlyArray<ContourJoint>;
};

const SAME_POINT_MM = 1e-9;
const NO_BUDGET = Number.MAX_SAFE_INTEGER;

export function sampleContour(
  curve: CurveSubpath,
  transform: Transform,
  sampleToleranceMm: number,
): ContourSamples {
  const largestScale = Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY));
  const pieces = mapCurveSubpath(curve, {
    map: (point) => applyTransform(point, transform),
    largestScale: largestScale > 0 && Number.isFinite(largestScale) ? largestScale : 1,
  });
  const first = pieces[0];
  if (first === undefined) {
    return { points: [applyTransform(curve.start, transform)], closed: curve.closed, joints: [] };
  }
  const points: Vec2[] = [first.start];
  const joints: ContourJoint[] = [];
  pieces.forEach((piece, index) => {
    const previous = pieces[index - 1];
    if (previous !== undefined) joints.push(jointBetween(previous, piece, points.length - 1));
    for (const point of pieceTail(piece, sampleToleranceMm)) pushDistinct(points, point);
  });
  const last = pieces[pieces.length - 1] as MappedPiece;
  if (!curve.closed) return { points, closed: false, joints };
  if (points.length > 1 && samePoint(points[0] as Vec2, points[points.length - 1] as Vec2)) {
    points.pop();
  }
  // The seam: the last piece runs back into the first point.
  joints.unshift(jointBetween(last, first, 0));
  return { points, closed: true, joints: joints.filter((joint) => joint.index < points.length) };
}

function jointBetween(previous: MappedPiece, next: MappedPiece, index: number): ContourJoint {
  const cos =
    previous.endTangent.x * next.startTangent.x + previous.endTangent.y * next.startTangent.y;
  return {
    index,
    turnRad: Math.acos(Math.max(-1, Math.min(1, cos))),
    betweenLines: previous.kind === 'line' && next.kind === 'line',
  };
}

// The piece's points after its start, ending exactly at its end.
function pieceTail(piece: MappedPiece, toleranceMm: number): ReadonlyArray<Vec2> {
  if (piece.kind === 'line') return [piece.end];
  if (piece.kind === 'dense') return piece.points.slice(1);
  const chords = flattenCubicChords(
    piece.start,
    { kind: 'cubic', control1: piece.control1, control2: piece.control2, to: piece.end },
    toleranceMm,
    NO_BUDGET,
  );
  return chords ?? [piece.end];
}

function pushDistinct(points: Vec2[], point: Vec2): void {
  const previous = points[points.length - 1];
  if (previous === undefined || !samePoint(previous, point)) points.push(point);
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= SAME_POINT_MM && Math.abs(a.y - b.y) <= SAME_POINT_MM;
}
