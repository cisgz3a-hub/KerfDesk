import type { Vec2 } from '../scene';
import type { Geometry, Contour, JointResizeRequest, JointCandidate } from './joint-resize-types';
import {
  cross,
  distance,
  dot,
  jointContourRelation,
  orthogonalJointPolygon,
  parallel,
  perpendicular,
  signedJointArea,
  subtract,
  unit,
} from './joint-resize-geometry';
const EPS = 1e-7;

export function detectCandidates(
  geometry: Geometry,
  contour: Contour,
  request: JointResizeRequest,
): JointCandidate[] {
  if (!orthogonalJointPolygon(contour.points)) return [];
  if (contour.points.length === 4) {
    const first = distance(contour.points[0] as Vec2, contour.points[1] as Vec2);
    const second = distance(contour.points[1] as Vec2, contour.points[2] as Vec2);
    const matches = [first, second].map(
      (value) => Math.abs(value - request.currentWidthMm) <= request.detectionToleranceMm,
    );
    const enclosed = geometry.contours.some(
      (other) =>
        other !== contour && jointContourRelation(contour.points, other.points) === 'inside',
    );
    if (!enclosed || matches[0] === matches[1]) return [];
    const start = matches[0] ? 0 : 1;
    const indices = [start, (start + 1) % 4, (start + 2) % 4, (start + 3) % 4];
    return [
      candidate(
        geometry,
        contour,
        'enclosed-rectangle',
        start,
        start === 0 ? first : second,
        start === 0 ? second : first,
        indices.map((vertex, i) => ({ vertex, sign: i === 0 || i === 3 ? -1 : 1 })),
      ),
    ];
  }
  return contour.points.flatMap((_, start) => detectSlot(geometry, contour, start, request));
}

function detectSlot(
  geometry: Geometry,
  contour: Contour,
  start: number,
  request: JointResizeRequest,
): JointCandidate[] {
  const n = contour.points.length;
  const at = (offset: number): Vec2 => contour.points[(start + offset + n) % n] as Vec2;
  const before = subtract(at(0), at(-1)),
    side = subtract(at(1), at(0)),
    base = subtract(at(2), at(1)),
    returnSide = subtract(at(3), at(2)),
    after = subtract(at(4), at(3));
  const width = Math.hypot(base.x, base.y);
  if (
    Math.abs(width - request.currentWidthMm) > request.detectionToleranceMm ||
    !perpendicular(side, base) ||
    !parallel(side, returnSide) ||
    dot(side, returnSide) >= 0 ||
    Math.abs(Math.hypot(side.x, side.y) - Math.hypot(returnSide.x, returnSide.y)) > EPS
  )
    return [];
  if (
    !parallel(before, base) ||
    !parallel(after, base) ||
    dot(before, base) <= 0 ||
    dot(after, base) <= 0
  )
    return [];
  const winding = Math.sign(signedJointArea(contour.points));
  if (Math.sign(cross(side, base)) === winding || Math.sign(cross(base, returnSide)) === winding)
    return [];
  const feature = candidate(
    geometry,
    contour,
    'inward-slot',
    start,
    width,
    Math.hypot(side.x, side.y),
    [0, 1, 2, 3].map((offset) => ({ vertex: (start + offset) % n, sign: offset < 2 ? -1 : 1 })),
  );
  return [{ ...feature, direction: unit(base) }];
}

function candidate(
  geometry: Geometry,
  contour: Contour,
  kind: JointCandidate['kind'],
  start: number,
  widthMm: number,
  depthMm: number,
  shifts: JointCandidate['shifts'],
): JointCandidate {
  const centre = shifts.reduce(
    (sum, shift) => ({
      x: sum.x + (contour.points[shift.vertex] as Vec2).x / shifts.length,
      y: sum.y + (contour.points[shift.vertex] as Vec2).y / shifts.length,
    }),
    { x: 0, y: 0 },
  );
  return {
    id: JSON.stringify([geometry.object.id, contour.pathIndex, contour.contourIndex, kind, start]),
    objectId: geometry.object.id,
    pathIndex: contour.pathIndex,
    contourIndex: contour.contourIndex,
    kind,
    widthMm,
    depthMm,
    centre,
    direction: unit(
      subtract(
        contour.points[(start + 1) % contour.points.length] as Vec2,
        contour.points[start] as Vec2,
      ),
    ),
    shifts,
  };
}
