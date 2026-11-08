// The separate pieces of one compiled burn, and whether a cut outline holds a
// piece (rolling audit v10 V7-P2-3, ADR-480 Amendment 3). One operation burns
// every part of a job, so two coasters' names are one group: the check asks
// about each name, not about the group's box.
import { PolygonEdgeIndex } from './geometry/polygon-edge-index';
import { pointInPolygon } from './geometry/point-in-polygon';
import { computeJobBounds, type CutSegment, type Group } from './job';
import { pointSegmentDistSq } from './min-feature/segment-distance';
import type { Vec2 } from './scene';
import type { ContourBox } from './trace/contour-bounds';

/** Segments closer than this are one piece: a Fill's scan rows join up, the
 * letters of one word may or may not, two coasters' names never do. */
const PIECE_GAP_MM = 0.5;
/** A point this close to an outline is on it, neither inside nor outside, so
 * an engraving that only touches a cut, or runs along it, is not held by it. */
const ON_OUTLINE_MM = 0.1;

export type BurnPiece = ContourBox & {
  /** The piece's paths; null for an image, which is judged by its box. */
  readonly polylines: ReadonlyArray<ReadonlyArray<Vec2>> | null;
};

export type OutlineRing = ContourBox & {
  readonly polyline: ReadonlyArray<Vec2>;
};

/** Each segment's box, by segment; NaN where a segment has no finite point. */
type SegmentBounds = {
  readonly minX: Float64Array;
  readonly minY: Float64Array;
  readonly maxX: Float64Array;
  readonly maxY: Float64Array;
};

/** The connected runs of a group's burn: segments within PIECE_GAP_MM of each
 * other are one piece. An image is one piece, its box. */
export function burnPieces(group: Exclude<Group, { readonly kind: 'cnc' }>): BurnPiece[] {
  if (group.kind === 'raster') {
    const bounds = computeJobBounds({ groups: [group] });
    return bounds === null ? [] : [{ ...bounds, polylines: null }];
  }
  const { segments } = group;
  const bounds = segmentBounds(segments);
  const parent = joinNearSegments(bounds);
  const pieceAt = new Int32Array(segments.length).fill(-1);
  const pieces: Array<MutableBox & { polylines: Array<ReadonlyArray<Vec2>> }> = [];
  segments.forEach((segment, at) => {
    if (Number.isNaN(bounds.minX[at])) return;
    const root = find(parent, at);
    let piece = pieces[pieceAt[root] as number];
    if (piece === undefined) {
      pieceAt[root] = pieces.length;
      piece = { ...EMPTY_BOX, polylines: [] };
      pieces.push(piece);
    }
    piece.minX = Math.min(piece.minX, bounds.minX[at] as number);
    piece.minY = Math.min(piece.minY, bounds.minY[at] as number);
    piece.maxX = Math.max(piece.maxX, bounds.maxX[at] as number);
    piece.maxY = Math.max(piece.maxY, bounds.maxY[at] as number);
    piece.polylines.push(segment.polyline);
  });
  return pieces;
}

/** Whether the outline holds the piece: every point of the piece, and the
 * middle of every edge, is inside the outline or on it, and some point is
 * clearly inside. The middles catch a scan row that leaves a concave outline
 * and comes back. An image is held when its box fits the outline's box and its
 * centre is inside the outline, so a picture in a round coaster still counts. */
export function outlineHoldsPiece(
  ring: OutlineRing,
  edges: () => PolygonEdgeIndex | null,
  piece: BurnPiece,
): boolean {
  if (!boxFits(piece, ring)) return false;
  if (piece.polylines === null) {
    const centre = { x: (piece.minX + piece.maxX) / 2, y: (piece.minY + piece.maxY) / 2 };
    return pointInPolygon(centre, ring.polyline);
  }
  const index = edges();
  return index !== null && pointsHeld(index, piece.polylines);
}

function boxFits(piece: ContourBox, ring: ContourBox): boolean {
  return (
    piece.minX >= ring.minX - ON_OUTLINE_MM &&
    piece.minY >= ring.minY - ON_OUTLINE_MM &&
    piece.maxX <= ring.maxX + ON_OUTLINE_MM &&
    piece.maxY <= ring.maxY + ON_OUTLINE_MM
  );
}

function pointsHeld(
  index: PolygonEdgeIndex,
  polylines: ReadonlyArray<ReadonlyArray<Vec2>>,
): boolean {
  let clearlyInside = false;
  for (const polyline of polylines) {
    for (let at = 0; at < polyline.length; at += 1) {
      const point = polyline[at] as Vec2;
      const previous = polyline[at - 1];
      const middle: Place =
        previous === undefined ? 'on' : place(index, midpoint(previous, point), clearlyInside);
      const end: Place = place(index, point, clearlyInside);
      if (middle === 'outside' || end === 'outside') return false;
      clearlyInside ||= middle === 'inside' || end === 'inside';
    }
  }
  return clearlyInside;
}

/** Where a point sits against the outline. Once some point is clearly inside,
 * a contained point needs no closer look. */
function place(index: PolygonEdgeIndex, point: Vec2, knownInside: boolean): Place {
  if (index.containsPoint(point)) return knownInside || !onOutline(index, point) ? 'inside' : 'on';
  return onOutline(index, point) ? 'on' : 'outside';
}

export function polygonEdges(ring: OutlineRing): () => PolygonEdgeIndex | null {
  let built: PolygonEdgeIndex | null | undefined;
  return () => {
    if (built === undefined) built = PolygonEdgeIndex.create(ring.polyline);
    return built;
  };
}

export function boxOf(polyline: ReadonlyArray<Vec2>): ContourBox {
  const box: MutableBox = { ...EMPTY_BOX };
  for (const point of polyline) {
    box.minX = Math.min(box.minX, point.x);
    box.minY = Math.min(box.minY, point.y);
    box.maxX = Math.max(box.maxX, point.x);
    box.maxY = Math.max(box.maxY, point.y);
  }
  return box;
}

type Place = 'inside' | 'on' | 'outside';

type MutableBox = { minX: number; minY: number; maxX: number; maxY: number };

const EMPTY_BOX: ContourBox = {
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
};

function segmentBounds(segments: ReadonlyArray<CutSegment>): SegmentBounds {
  const count = segments.length;
  const bounds = {
    minX: new Float64Array(count),
    minY: new Float64Array(count),
    maxX: new Float64Array(count),
    maxY: new Float64Array(count),
  };
  for (let at = 0; at < count; at += 1) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of (segments[at] as CutSegment).polyline) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const finite =
      Number.isFinite(minX) &&
      Number.isFinite(minY) &&
      Number.isFinite(maxX) &&
      Number.isFinite(maxY);
    bounds.minX[at] = finite ? minX : Number.NaN;
    bounds.minY[at] = minY;
    bounds.maxX[at] = maxX;
    bounds.maxY[at] = maxY;
  }
  return bounds;
}

// A sweep up the segments by their lowest Y: each meets only the segments
// still within PIECE_GAP_MM below it, which for a Fill's scan rows is the few
// rows just before it in every part the row crosses. Union-find joins them. A
// segment drops out once a joined later one spans it and reaches as high, so a
// Fill's rows keep about one live row per part.
function joinNearSegments(bounds: SegmentBounds): Int32Array {
  const { minX, minY, maxX, maxY } = bounds;
  const count = minX.length;
  const parent = new Int32Array(count);
  const byMinY: number[] = [];
  for (let at = 0; at < count; at += 1) {
    parent[at] = at;
    if (!Number.isNaN(minX[at])) byMinY.push(at);
  }
  // Compiled scan rows already run up the bed, which this sort passes through.
  byMinY.sort((a, b) => (minY[a] as number) - (minY[b] as number));
  const active = new Int32Array(count);
  let live = 0;
  for (const at of byMinY) {
    const floor = (minY[at] as number) - PIECE_GAP_MM;
    const left = (minX[at] as number) - PIECE_GAP_MM;
    const right = (maxX[at] as number) + PIECE_GAP_MM;
    let kept = 0;
    for (let k = 0; k < live; k += 1) {
      const other = active[k] as number;
      if ((maxY[other] as number) < floor) continue;
      active[kept] = other;
      kept += 1;
      if ((minX[other] as number) > right || left > (maxX[other] as number)) continue;
      union(parent, at, other);
      // Covered: whatever would still meet the older segment meets this one.
      if (covers(bounds, at, other)) kept -= 1;
    }
    active[kept] = at;
    live = kept + 1;
  }
  return parent;
}

function covers({ minX, maxX, maxY }: SegmentBounds, later: number, earlier: number): boolean {
  return (
    (minX[later] as number) <= (minX[earlier] as number) &&
    (maxX[earlier] as number) <= (maxX[later] as number) &&
    (maxY[earlier] as number) <= (maxY[later] as number)
  );
}

function onOutline(index: PolygonEdgeIndex, point: Vec2): boolean {
  const limit = ON_OUTLINE_MM * ON_OUTLINE_MM;
  const box = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
  return index.forEachEdgeNear(
    box,
    ON_OUTLINE_MM,
    (a, b) => pointSegmentDistSq(point.x, point.y, a.x, a.y, b.x, b.y) <= limit,
  );
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function find(parent: Int32Array, at: number): number {
  let root = at;
  while ((parent[root] as number) !== root) root = parent[root] as number;
  let walk = at;
  while ((parent[walk] as number) !== root) {
    const next = parent[walk] as number;
    parent[walk] = root;
    walk = next;
  }
  return root;
}

function union(parent: Int32Array, left: number, right: number): void {
  const a = find(parent, left);
  const b = find(parent, right);
  if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
}
