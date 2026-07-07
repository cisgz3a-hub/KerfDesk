// Apex recovery — potrace's polygon stage constrains its vertices near integer
// path points, and the subsequent curve stage rounds sharp convex tips: a
// ~27deg star tip is traced ~1-2px short of the true apex, and the official
// potrace 1.16 binary rounds it the same way, so this is inherent to the
// algorithm, not our port. This module runs AFTER curve sampling, on the final
// closed polylines, using the same binary bitmap potrace scanned.
//
// The rasterized ink genuinely stops ~2px short of a thin analytic apex (the
// tip pixel is the last ink cell), so marching a vertex to the ink boundary
// alone cannot recover the point. Instead we RECONSTRUCT the corner: the two
// straight flanks leaving the tip, extended, meet at the apex the ink defines.
// We snap the corner vertex to that intersection, but only ever OUTWARD, only
// when the outward direction has ink support (rejecting smooth curves and
// wrong-side moves), and never farther than APEX_MAX_SNAP_PX (so a mis-detected
// corner cannot run away, and a right-angle corner whose flanks already meet on
// the ink boundary is not pushed past it).

import type { Polyline, Vec2 } from '../scene';
import type { TraceBitmap } from './potrace-bitmap';

// A vertex is an apex candidate only if the polyline bends by at least this much
// across the measurement window. 50deg admits the star's ~27deg-tip corners and
// square 90deg corners while rejecting the few-degrees-per-sample bends of a
// densely sampled smooth curve.
const APEX_MIN_TURN_RAD = (50 * Math.PI) / 180;

// The flank edge lines are fit between a NEAR and a FAR arc offset from the
// vertex, in pixels. Sampling on the straighter part of each flank (rather than
// the rounded samples immediately beside the tip) is what lets the extrapolated
// intersection reach the true apex instead of the blunted curve.
const APEX_FLANK_NEAR_PX = 6;
const APEX_FLANK_FAR_PX = 14;

// Corner turn is measured over this arc window each side of the vertex, not
// between adjacent segments: CURVE segments are densely sampled, so a
// single-segment turn at a real corner reads as only a few degrees.
const APEX_WINDOW_PX = 2;

// The outward move is capped at this many pixels. Bounds a mis-detected corner
// and keeps a 90deg corner (flanks already meeting on the ink boundary) from
// being pushed past the ink.
const APEX_MAX_SNAP_PX = 2.5;

// Sub-pixel step used to test ink support for the outward direction.
const APEX_INK_PROBE_PX = 0.25;

// Two corner maxima closer than this along the ring collapse to the single
// sharper one, so one apex snaps exactly once even when several dense samples
// near the tip all clear the threshold.
const APEX_MIN_CORNER_SPACING_PX = 4;

// Smallest ring perimeter, in pixels, whose flanks can host a well-separated
// reconstructed apex: both flank windows plus a gap between them.
const APEX_MIN_RING_PERIMETER_PX = 2 * APEX_FLANK_FAR_PX;

type Ring = ReadonlyArray<Vec2>;

/**
 * Tuning for {@link snapCornersToInk}.
 *
 * `minRingPerimeterPx` — rings shorter than this are left untouched. Potrace
 * feeds well-separated glyph/shape contours whose every acute corner is a
 * genuinely blunted tip, so it needs no size floor beyond the geometric minimum
 * (default 0). Edge Detection additionally traces SMALL TEXT, whose ~30-180px
 * rings the Canny+ridge path already localises accurately; snapping their many
 * closely-spaced corners only re-facets them. Raising the floor above small-text
 * scale confines recovery to genuine large silhouette tips (star points, big
 * letter apexes) while leaving small text — and smooth curves, which have no
 * qualifying corners either way — exactly as traced.
 */
export type ApexSnapOptions = {
  readonly minRingPerimeterPx: number;
};

const DEFAULT_APEX_SNAP_OPTIONS: ApexSnapOptions = { minRingPerimeterPx: 0 };

/**
 * Snap genuine acute corner vertices of each closed polyline outward to the true
 * ink apex, using the same binary bitmap potrace scanned. Open polylines and
 * rings too small to have corners pass through unchanged. A vertex is only ever
 * moved outward, only when the outward direction is ink-supported, and never
 * farther than the snap cap.
 */
export function snapCornersToInk(
  polylines: ReadonlyArray<Polyline>,
  bitmap: TraceBitmap,
  options: ApexSnapOptions = DEFAULT_APEX_SNAP_OPTIONS,
): Polyline[] {
  return polylines.map((polyline) =>
    polyline.closed ? snapRing(polyline, bitmap, options) : polyline,
  );
}

function snapRing(polyline: Polyline, bitmap: TraceBitmap, options: ApexSnapOptions): Polyline {
  const ring = dedupeClosingPoint(polyline.points);
  if (ring.length < 3) return polyline;

  // Both flanks must fit on the ring without wrapping into each other, otherwise
  // the extrapolated intersection is meaningless. Tiny features (a single-pixel
  // 1x1 box) have too little perimeter and are left untouched. Callers may raise
  // the floor further (Edge Detection excludes small text this way).
  const perimeter = ringPerimeter(ring);
  if (perimeter < APEX_MIN_RING_PERIMETER_PX || perimeter < options.minRingPerimeterPx) {
    return polyline;
  }

  const cornerIndexes = selectCornerVertices(ring);
  if (cornerIndexes.size === 0) return polyline;

  const moved: Vec2[] = ring.map((vertex, index) => {
    if (!cornerIndexes.has(index)) return vertex;
    return snapVertex(ring, index, bitmap);
  });

  // Re-append the (possibly moved) start vertex: downstream job compilation
  // documents closed segments as "last point equals the first by
  // construction" (job.ts) and the emitters draw points as given — a ring
  // returned without its closing duplicate engraves with its final edge
  // missing. dedupeClosingPoint stripped it for the cyclic math above.
  const seam = moved[0];
  if (seam !== undefined) moved.push({ x: seam.x, y: seam.y });

  return { points: moved, closed: true };
}

// Drop a trailing point equal to the first — potrace polylines are closed by the
// `closed` flag, but some callers still duplicate the start; either way we treat
// the ring as an implicit cycle.
function dedupeClosingPoint(points: Ring): Vec2[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (
    points.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    first.x === last.x &&
    first.y === last.y
  ) {
    return points.slice(0, -1);
  }
  return points.slice();
}

// Corner vertices are the local turn maxima that clear the threshold, thinned so
// that within any APEX_MIN_CORNER_SPACING_PX arc only the sharpest survives.
function selectCornerVertices(ring: Ring): Set<number> {
  const turns = ring.map((_, index) => turnAngleAt(ring, index));
  const selected = new Set<number>();
  const sortedBySharpness = ring
    .map((_, index) => index)
    .filter((index) => (turns[index] ?? 0) >= APEX_MIN_TURN_RAD)
    .sort((a, b) => (turns[b] ?? 0) - (turns[a] ?? 0));

  for (const index of sortedBySharpness) {
    if (hasNearbySelected(ring, index, selected)) continue;
    selected.add(index);
  }
  return selected;
}

function hasNearbySelected(ring: Ring, index: number, selected: Set<number>): boolean {
  for (const other of selected) {
    if (ringArcDistance(ring, index, other) < APEX_MIN_CORNER_SPACING_PX) return true;
  }
  return false;
}

// Shorter-direction arc-length distance between two ring indices.
function ringArcDistance(ring: Ring, a: number, b: number): number {
  const forward = arcLengthForward(ring, a, b);
  const total = ringPerimeter(ring);
  return Math.min(forward, total - forward);
}

function arcLengthForward(ring: Ring, from: number, to: number): number {
  const count = (to - from + ring.length) % ring.length;
  let length = 0;
  for (let step = 0; step < count; step += 1) {
    length += segmentLength(ring, from + step);
  }
  return length;
}

function ringPerimeter(ring: Ring): number {
  let length = 0;
  for (let i = 0; i < ring.length; i += 1) length += segmentLength(ring, i);
  return length;
}

function segmentLength(ring: Ring, index: number): number {
  const p = ring[((index % ring.length) + ring.length) % ring.length];
  const q = ring[(((index + 1) % ring.length) + ring.length) % ring.length];
  if (p === undefined || q === undefined) return 0;
  return Math.hypot(q.x - p.x, q.y - p.y);
}

// Interior turn magnitude at `index`, measured between the incoming and outgoing
// directions found by walking APEX_WINDOW_PX of arc each way. Densely sampled
// curves yield near-zero turns; real corners stand out.
function turnAngleAt(ring: Ring, index: number): number {
  const back = walkArc(ring, index, -1, APEX_WINDOW_PX);
  const forward = walkArc(ring, index, 1, APEX_WINDOW_PX);
  const vertex = ring[index];
  if (back === null || forward === null || vertex === undefined) return 0;
  const backDir = unit({ x: vertex.x - back.x, y: vertex.y - back.y });
  const forwardDir = unit({ x: forward.x - vertex.x, y: forward.y - vertex.y });
  if (backDir === null || forwardDir === null) return 0;
  const dot = backDir.x * forwardDir.x + backDir.y * forwardDir.y;
  const cross = backDir.x * forwardDir.y - backDir.y * forwardDir.x;
  return Math.abs(Math.atan2(cross, dot));
}

// Point on the ring reached by walking `targetArc` pixels from `index` in the
// given step direction (+1 forward, -1 backward). Returns null if the ring is
// too small to walk that far.
function walkArc(ring: Ring, index: number, direction: 1 | -1, targetArc: number): Vec2 | null {
  const vertex = ring[index];
  if (vertex === undefined) return null;
  let walked = 0;
  let cursor = index;
  let far = vertex;
  // Bounded by ring.length steps: if we return to the start index before
  // reaching the target arc, the ring is too small for this flank window.
  let steps = 0;
  while (steps < ring.length) {
    const nextIndex = (cursor + direction + ring.length) % ring.length;
    const next = ring[nextIndex];
    if (next === undefined || nextIndex === index) return null;
    walked += Math.hypot(next.x - far.x, next.y - far.y);
    far = next;
    cursor = nextIndex;
    if (walked >= targetArc) return far;
    steps += 1;
  }
  return null;
}

function unit(v: Vec2): Vec2 | null {
  const length = Math.hypot(v.x, v.y);
  if (length === 0) return null;
  return { x: v.x / length, y: v.y / length };
}

// Reconstruct the corner apex by intersecting the two straight flank lines, then
// move the vertex there — but only outward, only when ink-supported, and never
// past the snap cap.
function snapVertex(ring: Ring, index: number, bitmap: TraceBitmap): Vec2 {
  const vertex = ring[index];
  if (vertex === undefined) return { x: 0, y: 0 };

  const backNear = walkArc(ring, index, -1, APEX_FLANK_NEAR_PX);
  const backFar = walkArc(ring, index, -1, APEX_FLANK_FAR_PX);
  const forwardNear = walkArc(ring, index, 1, APEX_FLANK_NEAR_PX);
  const forwardFar = walkArc(ring, index, 1, APEX_FLANK_FAR_PX);
  if (backNear === null || backFar === null || forwardNear === null || forwardFar === null) {
    return vertex;
  }

  const apex = intersectLines(backFar, backNear, forwardFar, forwardNear);
  if (apex === null) return vertex;

  const move = { x: apex.x - vertex.x, y: apex.y - vertex.y };
  const distance = Math.hypot(move.x, move.y);
  if (distance === 0) return vertex;

  const direction = { x: move.x / distance, y: move.y / distance };
  // Confirm this is a real convex ink corner and that the apex lies OUTWARD: the
  // body of the shape must sit behind the vertex, i.e. a small step from the
  // vertex back along the move direction (into the shape) is ink. Probing ahead
  // instead would wrongly reject axis-aligned tips, whose ink ends exactly on
  // the forward pixel boundary even though the corner is genuine.
  if (
    !isInk(bitmap, {
      x: vertex.x - direction.x * APEX_INK_PROBE_PX,
      y: vertex.y - direction.y * APEX_INK_PROBE_PX,
    })
  ) {
    return vertex;
  }

  const capped = Math.min(distance, APEX_MAX_SNAP_PX);
  return { x: vertex.x + direction.x * capped, y: vertex.y + direction.y * capped };
}

// Intersection of line through (a0->a1) and line through (b0->b1). Null when the
// flank directions are near-parallel (no well-defined corner).
function intersectLines(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): Vec2 | null {
  const da = { x: a1.x - a0.x, y: a1.y - a0.y };
  const db = { x: b1.x - b0.x, y: b1.y - b0.y };
  const det = da.x * -db.y - da.y * -db.x;
  if (Math.abs(det) < 1e-9) return null;
  const rx = b0.x - a0.x;
  const ry = b0.y - a0.y;
  const t = (rx * -db.y - ry * -db.x) / det;
  return { x: a0.x + t * da.x, y: a0.y + t * da.y };
}

function isInk(bitmap: TraceBitmap, point: Vec2): boolean {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return false;
  return bitmap.data[y * bitmap.width + x] === 1;
}
