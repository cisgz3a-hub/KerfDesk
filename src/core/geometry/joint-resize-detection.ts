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
// A width exactly at the tolerance edge still matches: a slot from 0 to 3.1
// measures 0.10000000000000009 away from 3 in floating point (T31-P3-2).
const TOLERANCE_SLACK_MM = 1e-6;
// How far off a tab's root line a shoulder may lie and still run along it.
const ROOT_LINE_MM = 1e-6;

/** Whether a measured design dimension is the declared current width. */
export function matchesCurrentWidth(valueMm: number, request: JointResizeRequest): boolean {
  return (
    Math.abs(valueMm - request.currentWidthMm) <= request.detectionToleranceMm + TOLERANCE_SLACK_MM
  );
}

/** How many other contours of the object hold this one. Even is a part's own
 *  edge (material inside it), odd is a cutout (opening inside it): even-odd. */
export function nestingDepth(geometry: Geometry, contour: Contour): number {
  return geometry.contours.filter(
    (other) => other !== contour && jointContourRelation(contour.points, other.points) === 'inside',
  ).length;
}

export function detectCandidates(
  geometry: Geometry,
  contour: Contour,
  request: JointResizeRequest,
): JointCandidate[] {
  if (!orthogonalJointPolygon(contour.points)) return [];
  const depth = nestingDepth(geometry, contour);
  if (contour.points.length === 4) {
    const first = distance(contour.points[0] as Vec2, contour.points[1] as Vec2);
    const second = distance(contour.points[1] as Vec2, contour.points[2] as Vec2);
    const matches = [first, second].map((value) => matchesCurrentWidth(value, request));
    // Only a cutout is an opening; a rectangular part lying in another part's
    // cutout is material (T31-P2-1).
    if (depth % 2 === 0 || matches[0] === matches[1]) return [];
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
  // The turn that bends around material: a part's edge holds material on its
  // own winding side, a cutout's edge on the other, so a cutout's bulge is an
  // opening into the material and its dent a tooth of material (T31-P2-1).
  const material = Math.sign(signedJointArea(contour.points)) * (depth % 2 === 0 ? 1 : -1);
  return contour.points.flatMap((_, start) =>
    detectSlot(geometry, contour, start, request, material),
  );
}

function detectSlot(
  geometry: Geometry,
  contour: Contour,
  start: number,
  request: JointResizeRequest,
  material: number,
): JointCandidate[] {
  const n = contour.points.length;
  const at = (offset: number): Vec2 => contour.points[(start + offset + n) % n] as Vec2;
  const before = subtract(at(0), at(-1)),
    side = subtract(at(1), at(0)),
    base = subtract(at(2), at(1)),
    returnSide = subtract(at(3), at(2)),
    after = subtract(at(4), at(3));
  const width = Math.hypot(base.x, base.y);
  if (!rectangularNotch(before, side, base, returnSide, after)) return [];
  const outward =
    Math.sign(cross(side, base)) === material && Math.sign(cross(base, returnSide)) === material;
  if (outward)
    return detectTab(geometry, contour, start, request, Math.hypot(side.x, side.y), width, side);
  if (!matchesCurrentWidth(width, request)) return [];
  if (Math.sign(cross(side, base)) === material || Math.sign(cross(base, returnSide)) === material)
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

// Two equal parallel sides square to a base, on a straight edge running on
// either side: the outline of a U-slot cut in, or a tab standing out.
function rectangularNotch(
  before: Vec2,
  side: Vec2,
  base: Vec2,
  returnSide: Vec2,
  after: Vec2,
): boolean {
  return (
    perpendicular(side, base) &&
    parallel(side, returnSide) &&
    dot(side, returnSide) < 0 &&
    Math.abs(Math.hypot(side.x, side.y) - Math.hypot(returnSide.x, returnSide.y)) <= EPS &&
    parallel(before, base) &&
    parallel(after, base) &&
    dot(before, base) > 0 &&
    dot(after, base) > 0
  );
}

// A tab sticking out of a straight edge: its depth is the thickness of the
// part it passes through, so the outer two corners move along its sides.
function detectTab(
  geometry: Geometry,
  contour: Contour,
  start: number,
  request: JointResizeRequest,
  depth: number,
  width: number,
  side: Vec2,
): JointCandidate[] {
  if (!matchesCurrentWidth(depth, request)) return [];
  const n = contour.points.length;
  const feature = candidate(
    geometry,
    contour,
    'outward-tab',
    start,
    width,
    depth,
    [1, 2].map((offset) => ({ vertex: (start + offset) % n, sign: 1 as const })),
  );
  return [{ ...feature, direction: unit(side) }];
}

/**
 * The joint steps of the current width on a contour that none of `candidates`
 * moves. A joint step is an edge between one corner turning each way: the
 * flank of a finger or a notch. A finger at a panel corner, or a notch between
 * two such fingers, has flanks no candidate holds, so resizing the others alone
 * would leave a finger-jointed outline with mixed depths (T31-P1-1). A shoulder
 * running along a found tab's root line, beside the end finger of an edge, is
 * part of the edge the tab stands on, not a step, and does not count.
 */
export function unmovedJointSteps(
  contour: Contour,
  candidates: ReadonlyArray<JointCandidate>,
  request: JointResizeRequest,
): number {
  const n = contour.points.length;
  const at = (index: number): Vec2 => contour.points[(index + n) % n] as Vec2;
  const moved = new Set(
    candidates.flatMap((feature) => feature.shifts.map(({ vertex }) => vertex)),
  );
  const roots = candidates
    .filter((feature) => feature.kind === 'outward-tab')
    .map((feature) => ({
      direction: feature.direction,
      level: dot(feature.centre, feature.direction) - feature.depthMm,
    }));
  const onRootLine = (from: Vec2, to: Vec2): boolean =>
    roots.some(
      ({ direction, level }) =>
        Math.abs(dot(from, direction) - level) <= ROOT_LINE_MM &&
        Math.abs(dot(to, direction) - level) <= ROOT_LINE_MM,
    );
  let steps = 0;
  for (let i = 0; i < n; i += 1) {
    if (moved.has(i) || moved.has((i + 1) % n)) continue;
    const from = at(i),
      to = at(i + 1);
    const edge = subtract(to, from);
    if (!matchesCurrentWidth(Math.hypot(edge.x, edge.y), request)) continue;
    const enter = Math.sign(cross(subtract(from, at(i - 1)), edge));
    const leave = Math.sign(cross(edge, subtract(at(i + 2), to)));
    if (enter === 0 || leave === 0 || enter === leave || onRootLine(from, to)) continue;
    steps += 1;
  }
  return steps;
}

/** The object's name as the user sees it, or its id when it has none. */
export function jointObjectLabel(object: {
  readonly id: string;
  readonly name?: string | undefined;
}): string {
  const name = object.name?.trim() ?? '';
  return name === '' ? object.id : name;
}

/** The dimension the request measures: a tab's depth, an opening's width. */
export function measuredMm(feature: JointCandidate): number {
  return feature.kind === 'outward-tab' ? feature.depthMm : feature.widthMm;
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
    objectName: jointObjectLabel(geometry.object),
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
