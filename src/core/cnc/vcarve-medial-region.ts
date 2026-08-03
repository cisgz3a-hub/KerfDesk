import { pointInPolygon } from '../geometry';
import type { NormalizedPolylineTreeNode } from '../geometry/polygon-difference';
import type { Polyline, Vec2 } from '../scene';

const GEOMETRY_EPSILON_MM = 1e-8;

export type VCarveMedialRegion = {
  readonly outer: Polyline;
  readonly holes: ReadonlyArray<Polyline>;
  readonly loops: ReadonlyArray<Polyline>;
};

export type VCarveBoundarySegment = {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly loopIndex: number;
  readonly edgeIndex: number;
  readonly loopEdgeCount: number;
};

/** Split Clipper's normalized ownership tree into filled roots plus their direct holes. */
export function vcarveMedialRegionsFromTree(
  nodes: ReadonlyArray<NormalizedPolylineTreeNode>,
): ReadonlyArray<VCarveMedialRegion> {
  const holesByParent = new Map<number, Polyline[]>();
  nodes.forEach((node) => {
    if (!node.isHole || node.parentIndex === null) return;
    const holes = holesByParent.get(node.parentIndex);
    if (holes === undefined) holesByParent.set(node.parentIndex, [node.contour]);
    else holes.push(node.contour);
  });
  return nodes.flatMap((node, index) => {
    if (node.isHole) return [];
    const holes = holesByParent.get(index) ?? [];
    return [{ outer: node.contour, holes, loops: [node.contour, ...holes] }];
  });
}

export function vcarveBoundarySegments(
  region: VCarveMedialRegion,
): ReadonlyArray<VCarveBoundarySegment> {
  return region.loops.flatMap((loop, loopIndex) => {
    const points = distinctLoopPoints(loop.points);
    return points.flatMap((a, edgeIndex) => {
      const b = points[(edgeIndex + 1) % points.length];
      return b === undefined || samePoint(a, b)
        ? []
        : [{ a, b, loopIndex, edgeIndex, loopEdgeCount: points.length }];
    });
  });
}

export function pointInVCarveRegion(point: Vec2, region: VCarveMedialRegion): boolean {
  return region.loops.reduce(
    (inside, loop) => (pointInPolygon(point, loop.points) ? !inside : inside),
    false,
  );
}

export function pointInOrOnVCarveRegion(
  point: Vec2,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment> = vcarveBoundarySegments(region),
): boolean {
  if (pointInVCarveRegion(point, region)) return true;
  // A segment whose bounding box is further than the tolerance from the point
  // cannot be within the tolerance of it, so the exact distance is only worth
  // computing for the few segments that survive this test. Same verdict, far
  // less work: this predicate runs twice per chord, and the route builder tests
  // O(V^2) chords against O(V) segments.
  for (const segment of segments) {
    if (boxMissesBox(segment, point.x, point.y, point.x, point.y, GEOMETRY_EPSILON_MM)) continue;
    if (pointToVCarveSegmentDistance(point, segment) <= GEOMETRY_EPSILON_MM) return true;
  }
  return false;
}

/**
 * True when the segment's axis-aligned bounding box, grown by `slack`, cannot
 * touch the query box. A pure rejection filter — anything it discards was
 * already impossible, so callers keep their exact results.
 */
function boxMissesBox(
  segment: VCarveBoundarySegment,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  slack: number,
): boolean {
  return (
    Math.min(segment.a.x, segment.b.x) > maxX + slack ||
    Math.max(segment.a.x, segment.b.x) < minX - slack ||
    Math.min(segment.a.y, segment.b.y) > maxY + slack ||
    Math.max(segment.a.y, segment.b.y) < minY - slack
  );
}

/**
 * Exact line/segment checks certify the whole chord, not just its endpoints or midpoint.
 * A boundary touch in the chord interior is rejected; a zero-clearance corner endpoint is allowed.
 */
export function vcarveChordInsideRegion(
  from: Vec2,
  to: Vec2,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
): boolean {
  if (!pointInOrOnVCarveRegion(from, region, segments)) return false;
  if (!pointInOrOnVCarveRegion(to, region, segments)) return false;
  if (samePoint(from, to)) return true;

  // Two segments whose bounding boxes do not overlap cannot intersect, so this
  // filter changes no verdict. It matters because the chords the route builder
  // tests are short next to the region's whole boundary, and without it every
  // one of O(V^2) chord tests paid an exact intersection against all O(V)
  // segments — the cost that made a single carved letter take seconds.
  const chordMinX = Math.min(from.x, to.x);
  const chordMaxX = Math.max(from.x, to.x);
  const chordMinY = Math.min(from.y, to.y);
  const chordMaxY = Math.max(from.y, to.y);
  for (const boundary of segments) {
    if (boxMissesBox(boundary, chordMinX, chordMinY, chordMaxX, chordMaxY, 0)) continue;
    const intersection = segmentIntersectionParameters(from, to, boundary.a, boundary.b);
    if (intersection.kind === 'overlap') return false;
    if (
      intersection.kind === 'point' &&
      intersection.alongChord > GEOMETRY_EPSILON_MM &&
      intersection.alongChord < 1 - GEOMETRY_EPSILON_MM
    ) {
      return false;
    }
  }

  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  return pointInVCarveRegion(midpoint, region);
}

export function minimumVCarveBoundaryDistance(
  point: Vec2,
  segments: ReadonlyArray<VCarveBoundarySegment>,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    minimum = Math.min(minimum, pointToVCarveSegmentDistance(point, segment));
  }
  return minimum;
}

export function pointToVCarveSegmentDistance(
  point: Vec2,
  segment: Pick<VCarveBoundarySegment, 'a' | 'b'>,
): number {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared,
          ),
        );
  return Math.hypot(point.x - (segment.a.x + t * dx), point.y - (segment.a.y + t * dy));
}

export function distinctLoopPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const clean: Vec2[] = [];
  for (const point of points) {
    if (Number.isFinite(point.x) && Number.isFinite(point.y) && !samePoint(clean.at(-1), point)) {
      clean.push(point);
    }
  }
  if (samePoint(clean[0], clean.at(-1))) clean.pop();
  return clean;
}

function samePoint(a: Vec2 | undefined, b: Vec2 | undefined): boolean {
  return a !== undefined && b !== undefined && a.x === b.x && a.y === b.y;
}

type SegmentIntersection =
  | { readonly kind: 'none' }
  | { readonly kind: 'overlap' }
  | { readonly kind: 'point'; readonly alongChord: number };

function segmentIntersectionParameters(a: Vec2, b: Vec2, c: Vec2, d: Vec2): SegmentIntersection {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  const cax = c.x - a.x;
  const cay = c.y - a.y;
  const numeratorT = cax * sy - cay * sx;
  const numeratorU = cax * ry - cay * rx;

  if (Math.abs(denominator) <= GEOMETRY_EPSILON_MM) {
    return collinearIntersection(a, c, d, { x: rx, y: ry }, cax, cay);
  }

  const t = numeratorT / denominator;
  const u = numeratorU / denominator;
  return t >= -GEOMETRY_EPSILON_MM &&
    t <= 1 + GEOMETRY_EPSILON_MM &&
    u >= -GEOMETRY_EPSILON_MM &&
    u <= 1 + GEOMETRY_EPSILON_MM
    ? { kind: 'point', alongChord: t }
    : { kind: 'none' };
}

function collinearIntersection(
  chordStart: Vec2,
  segmentStart: Vec2,
  segmentEnd: Vec2,
  chord: Vec2,
  offsetX: number,
  offsetY: number,
): SegmentIntersection {
  if (Math.abs(offsetX * chord.y - offsetY * chord.x) > GEOMETRY_EPSILON_MM) {
    return { kind: 'none' };
  }
  const axisX = Math.abs(chord.x) >= Math.abs(chord.y);
  const chordLength = axisX ? chord.x : chord.y;
  if (Math.abs(chordLength) <= GEOMETRY_EPSILON_MM) return { kind: 'none' };
  const origin = axisX ? chordStart.x : chordStart.y;
  const start = ((axisX ? segmentStart.x : segmentStart.y) - origin) / chordLength;
  const end = ((axisX ? segmentEnd.x : segmentEnd.y) - origin) / chordLength;
  const overlapStart = Math.max(0, Math.min(start, end));
  const overlapEnd = Math.min(1, Math.max(start, end));
  return overlapEnd - overlapStart > GEOMETRY_EPSILON_MM ? { kind: 'overlap' } : { kind: 'none' };
}
