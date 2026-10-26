// The rings operations cut from one scene contour (ADR-626 Amendments 3-6).
// With one ring per operation they are one outline however each operation
// offsets it. A kerf offset can split a contour into pieces, each a part of its
// own, and another operation may cut the same contour whole or split it its own
// way. Which rings are one part is decided by containment, not by bounds: two
// rings of different operations correspond when a point just inside one lies
// inside the other. A piece lies inside the whole outline it was split from,
// and counterpart pieces at different kerf offsets nest; pieces of one contour
// that are different parts never do, even where their bounds interlock.
//
// Rings are found through a box index, so a contour split into thousands of
// pieces costs each ring only its neighbours.

import { pointInPolygon } from '../geometry';
import { PolygonEdgeIndex } from '../geometry/polygon-edge-index';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import type { Vec2 } from '../scene';
import { ContourBoxIndex } from '../trace/contour-box-index';
import { outlinesAreCopies } from './laser-lead-copies';
import type { LeadRing } from './laser-lead-obstacles';
import type { LeadSideVerdict } from './laser-lead-sides';

// Rings with more points than this are tested for containment through an
// index of their edges.
const INDEXED_RING_POINTS = 32;

export type PieceLookup = {
  /** The other rings whose bounds meet ring `index`'s, in ring order. */
  readonly near: (index: number) => ReadonlyArray<number>;
  /** Whether rings `a` and `b` are one part: a point inside one is in the other. */
  readonly correspond: (a: number, b: number) => boolean;
};

export function pieceLookup(rings: ReadonlyArray<LeadRing>): PieceLookup {
  const boxes = rings.flatMap((ring, index) =>
    [ring.bounds.minX, ring.bounds.minY, ring.bounds.maxX, ring.bounds.maxY].every(Number.isFinite)
      ? [{ ...ring.bounds, ring: index }]
      : [],
  );
  const tree = boxes.length === 0 ? null : ContourBoxIndex.create(boxes);
  const probes = new Map<number, Vec2 | null>();
  const probe = (index: number): Vec2 | null => {
    if (!probes.has(index)) probes.set(index, insidePoint(rings[index]?.points ?? []));
    return probes.get(index) ?? null;
  };
  // A ring with many edges is tested through an index of them, built once: a
  // whole outline every one of thousands of pieces lies in is asked once per
  // piece, and a scan of its edges each time would cost their product.
  const indexes = new Map<number, PolygonEdgeIndex | null>();
  const holds = (container: number, point: Vec2 | null): boolean => {
    const ring = rings[container];
    if (point === null || ring === undefined) return false;
    if (ring.points.length <= INDEXED_RING_POINTS) return pointInPolygon(point, ring.points);
    if (!indexes.has(container)) indexes.set(container, PolygonEdgeIndex.create(ring.points));
    const index = indexes.get(container) ?? null;
    return index === null ? pointInPolygon(point, ring.points) : index.containsPoint(point);
  };
  return {
    near: (index) => {
      const ring = rings[index];
      if (ring === undefined || tree === null) return [];
      return tree
        .query(ring.bounds)
        .map((box) => box.ring)
        .filter((other) => other !== index)
        .sort((a, b) => a - b);
    },
    correspond: (a, b) => holds(b, probe(a)) || holds(a, probe(b)),
  };
}

/** Assigns copy classes to the rings of each scene contour some operation
 * split: a ring takes the class of the earlier ring of its own operation it
 * copies exactly (drawn twice), else of the earlier ring of the same kind in
 * another operation it corresponds to and overlaps most: a piece's counterpart
 * piece at that operation's offset, or for a whole outline the whole outline
 * another operation cuts; else a class of its own. The contour's first ring
 * keeps the contour's class. A whole outline is no copy of a piece of it: they
 * are not one burn, so each keeps clear of the other's leads, and the piece is
 * only exempt from the outline itself (pieceExemptions). Two different pieces
 * of one operation never share a class. */
export function pieceClasses(
  rings: ReadonlyArray<LeadRing>,
  groups: ReadonlyArray<number>,
  sides: LeadSideVerdict[],
  fresh: number,
  lookup: PieceLookup,
): void {
  const source = sides.map((side) => side.copyClass);
  const split = splitSources(source, groups);
  const pieceKeys = splitGroups(source, groups);
  const taken = new Map<string, Set<number>>();
  const started = new Set<number>();
  rings.forEach((ring, index) => {
    const own = source[index] as number;
    const side = sides[index];
    if (!split.has(own) || side === undefined) return;
    const group = groups[index] ?? -1;
    const key = `${own}:${group}`;
    const used = taken.get(key) ?? new Set<number>();
    const earlier = lookup.near(index).filter((other) => other < index && source[other] === own);
    const twin = earlier.find(
      (other) => groups[other] === group && outlinesAreCopies(rings[other] as LeadRing, ring),
    );
    // A piece pairs with a piece, and a whole outline with the whole outline
    // another operation that left the contour whole cuts: those stay copies.
    const isPiece = pieceKeys.has(key);
    const counterpart =
      twin ??
      largestOverlap(
        rings,
        ring,
        earlier.filter(
          (other) =>
            groups[other] !== group &&
            pieceKeys.has(`${own}:${groups[other] ?? -1}`) === isPiece &&
            !used.has(sides[other]?.copyClass ?? Number.NaN) &&
            lookup.correspond(index, other),
        ),
      );
    const match = counterpart === undefined ? undefined : sides[counterpart];
    const copyClass =
      match !== undefined ? match.copyClass : started.has(own) ? fresh + index : own;
    started.add(own);
    sides[index] = { ...side, copyClass };
    used.add(copyClass);
    taken.set(key, used);
  });
}

/** For each ring, the rings its leads may cross and end inside: its copies,
 * and every ring another operation cuts from the same scene contour, or from a
 * coincident one (`sceneClasses` shared), that is one part with it. Not a copy
 * relation: the pieces of one operation are each exempt from the whole
 * outline, never from each other. */
export function pieceExemptions(
  rings: ReadonlyArray<LeadRing>,
  groups: ReadonlyArray<number>,
  copies: ReadonlyArray<ReadonlyArray<number>>,
  lookup: PieceLookup,
  sceneClasses: ReadonlyArray<number>,
): number[][] {
  return rings.map((_, index) => {
    const parts = lookup
      .near(index)
      .filter(
        (other) =>
          sceneClasses[other] === sceneClasses[index] &&
          groups[other] !== groups[index] &&
          lookup.correspond(index, other),
      );
    return [...new Set([...(copies[index] ?? []), ...parts])];
  });
}

/** The scene contours some operation cut as more than one ring. */
function splitSources(source: ReadonlyArray<number>, groups: ReadonlyArray<number>): Set<number> {
  return new Set([...splitGroups(source, groups)].map((key) => Number(key.split(':')[0])));
}

/** `contour:operation` for each operation that cut a contour as more than one ring. */
function splitGroups(source: ReadonlyArray<number>, groups: ReadonlyArray<number>): Set<string> {
  const seen = new Set<string>();
  const split = new Set<string>();
  source.forEach((own, index) => {
    const key = `${own}:${groups[index] ?? -1}`;
    if (seen.has(key)) split.add(key);
    seen.add(key);
  });
  return split;
}

function largestOverlap(
  rings: ReadonlyArray<LeadRing>,
  ring: LeadRing,
  candidates: ReadonlyArray<number>,
): number | undefined {
  let best: number | undefined;
  let bestShare = 0;
  for (const candidate of candidates) {
    const other = rings[candidate];
    if (other === undefined) continue;
    const share = boundsOverlapShare(ring.bounds, other.bounds);
    if (share > bestShare) {
      best = candidate;
      bestShare = share;
    }
  }
  return best;
}

function boundsOverlapShare(a: LeadRing['bounds'], b: LeadRing['bounds']): number {
  const width = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const height = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (!(width > 0) || !(height > 0)) return 0;
  const area = (box: LeadRing['bounds']) => (box.maxX - box.minX) * (box.maxY - box.minY);
  return (width * height) / Math.min(area(a), area(b));
}

/** A point inside the ring: from the middle of an edge, halfway along the
 * inward normal to the ring's next wall, so it stays inside however narrow the
 * ring is. Edges are tried longest first. */
function insidePoint(points: ReadonlyArray<Vec2>): Vec2 | null {
  const area = signedAreaMm2(points);
  if (area === 0 || !Number.isFinite(area)) return null;
  // Counter-clockwise (positive area), the inside is on the left of each edge.
  const side = area > 0 ? 1 : -1;
  const edges = points
    .slice(1)
    .map((to, index) => ({ from: points[index] as Vec2, to }))
    .filter(({ from, to }) => from.x !== to.x || from.y !== to.y)
    .sort((a, b) => edgeLength(b) - edgeLength(a))
    .slice(0, PROBE_EDGES);
  for (const { from, to } of edges) {
    const length = edgeLength({ from, to });
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const inward = { x: (-side * (to.y - from.y)) / length, y: (side * (to.x - from.x)) / length };
    const wall = nearestWallMm(points, middle, inward);
    if (wall === null) continue;
    const point = { x: middle.x + (inward.x * wall) / 2, y: middle.y + (inward.y * wall) / 2 };
    if (pointInPolygon(point, points)) return point;
  }
  return null;
}

// Edges tried for a probe point before giving up.
const PROBE_EDGES = 8;

function edgeLength(edge: { readonly from: Vec2; readonly to: Vec2 }): number {
  return Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y);
}

/** How far along the ray from `origin` in `direction` the ring is first met,
 * past the origin's own edge; null when it is never met. */
function nearestWallMm(points: ReadonlyArray<Vec2>, origin: Vec2, direction: Vec2): number | null {
  let nearest: number | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const determinant = direction.x * sy - direction.y * sx;
    if (determinant === 0) continue;
    const wx = a.x - origin.x;
    const wy = a.y - origin.y;
    const along = (wx * sy - wy * sx) / determinant;
    const on = (wx * direction.y - wy * direction.x) / determinant;
    if (along > SAME_EDGE_MM && on >= 0 && on <= 1 && (nearest === null || along < nearest)) {
      nearest = along;
    }
  }
  return nearest;
}

// A wall nearer than this along the ray is the edge the ray starts on.
const SAME_EDGE_MM = 1e-9;
