// Stay-down pocket links (ADR-491). A pocket level used to lift to safe Z
// after every ring and raster row, rapid over and plunge straight back into
// partly uncut stock. Here, a pass that starts at the depth the previous pass
// ended at is reached by a short feed move at that depth instead: a two-point
// path3d "link" at the plunge feed, so the one moment of wider engagement stays
// light. A closed ring is re-started at its point nearest the bit, and an open
// raster row may run from its nearer end.
//
// A link is kept only when it is provably harmless: no longer than one bit
// diameter, and its tool centre stays at least the wall radius inside the
// pocket's own boundary (islands included), the same clearance the finishing
// ring keeps. Anything else keeps the old lift, so a link never cuts a wall,
// an island or stock outside the pocket.
//
// Pockets with islands or arms plan their rings and rows across all pieces of
// a level at once, so the plan hops between pieces. A pass may be pulled
// forward to link when every pass still waiting ahead of it lies more than a
// bit diameter away: the two cuts share no stock, so each removes the same
// material under the same load as planned, with fewer trips up and down.

import type { CncContourPass, CncHelicalContourPass, CncPass, CncPath3dPass } from '../job';
import type { Vec3 } from '../geometry/vec3';
import type { CncLayerSettings, Polyline, Vec2 } from '../scene';

export type PocketLinkRegion = {
  // The closed contours the pocket clears, islands included.
  readonly boundary: ReadonlyArray<Polyline>;
  // Tool-centre clearance from the boundary: the radius the wall ring uses.
  readonly toolRadiusMm: number;
};

// The clipper offsets that place every ring round their joins to about a
// micron, so a ring can sit that much closer than the radius. A link may come
// no closer than the rings themselves do.
const CLEARANCE_TOLERANCE_MM = 0.005;
const SAME_POINT_MM = 1e-6;
const VERTEX_SNAP_MM = 0.01;
// How many waiting passes a level searches for one to link to. Pieces of a
// pocket interleave one pass each, so the next pass of the same piece is a few
// places ahead; the cap keeps a huge raster from an all-pairs search.
const LOOKAHEAD_PASSES = 64;

type Edge = {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type LevelPass = CncContourPass | CncHelicalContourPass;

type LinkContext = {
  readonly edges: ReadonlyArray<Edge>;
  readonly radius: number;
  // Longest link, and the gap two passes need to share no stock: one diameter.
  readonly diameter: number;
};

type Linked = { readonly link: CncPath3dPass | null; readonly pass: CncContourPass };

// A pocket operation's passes with stay-down links, unless the operator asked
// for the lift between rings. `wallDiameterMm` is the width its wall ring was
// inset by.
export function pocketPassLinks(
  passes: ReadonlyArray<CncPass>,
  boundary: ReadonlyArray<Polyline>,
  settings: Pick<CncLayerSettings, 'pocketLiftBetweenRings'>,
  wallDiameterMm: number,
): ReadonlyArray<CncPass> {
  if (settings.pocketLiftBetweenRings === true) return passes;
  return stayDownPocketPasses(passes, { boundary, toolRadiusMm: wallDiameterMm / 2 });
}

export function stayDownPocketPasses(
  passes: ReadonlyArray<CncPass>,
  region: PocketLinkRegion,
): ReadonlyArray<CncPass> {
  const radius = region.toolRadiusMm;
  if (!(radius > 0) || !Number.isFinite(radius)) return passes;
  const context: LinkContext = {
    edges: boundaryEdges(region.boundary),
    radius,
    diameter: 2 * radius,
  };
  const out: CncPass[] = [];
  let first = 0;
  while (first < passes.length) {
    const pass = passes[first] as CncPass;
    if (!isLevelPass(pass)) {
      out.push(pass);
      first += 1;
      continue;
    }
    let after = first + 1;
    while (after < passes.length && sameLevel(passes[after] as CncPass, pass.zMm)) after += 1;
    appendLevel(passes.slice(first, after) as ReadonlyArray<LevelPass>, context, out);
    first = after;
  }
  return out;
}

function isLevelPass(pass: CncPass): pass is LevelPass {
  return pass.kind === 'contour' || pass.kind === 'helical-contour';
}

function sameLevel(pass: CncPass, zMm: number): boolean {
  return isLevelPass(pass) && pass.zMm === zMm;
}

// One depth level: the planned order, except that the pass cut next is the
// first waiting pass that links to the one just cut and shares no stock with
// any pass still waiting ahead of it. With no such pass, the plan's next pass
// runs with its own entry, exactly as planned.
function appendLevel(level: ReadonlyArray<LevelPass>, context: LinkContext, out: CncPass[]): void {
  const boxes = level.map((pass) => polylineBox(pass.polyline));
  const waiting = level.map((_, index) => index);
  let end: Vec3 | null = null;
  while (waiting.length > 0) {
    const pick = end === null ? null : nextLinked(end, level, boxes, waiting, context);
    if (pick === null) {
      const pass = level[waiting.shift() as number] as LevelPass;
      out.push(pass);
      end = passEnd(pass);
      continue;
    }
    waiting.splice(pick.position, 1);
    if (pick.linked.link !== null) out.push(pick.linked.link);
    out.push(pick.linked.pass);
    end = passEnd(pick.linked.pass);
  }
}

function nextLinked(
  end: Vec3,
  level: ReadonlyArray<LevelPass>,
  boxes: ReadonlyArray<Box | null>,
  waiting: ReadonlyArray<number>,
  context: LinkContext,
): { readonly position: number; readonly linked: Linked } | null {
  const searched = Math.min(waiting.length, LOOKAHEAD_PASSES);
  for (let position = 0; position < searched; position += 1) {
    const index = waiting[position] as number;
    const box = boxes[index] ?? null;
    if (box === null || pointBoxGap(end, box) > context.diameter) continue;
    if (!sharesNoStockWithEarlier(box, position, boxes, waiting, context.diameter)) continue;
    const linked = linkedPass(end, level[index] as LevelPass, context);
    if (linked !== null) return { position, linked };
  }
  return null;
}

// Two passes whose boxes lie more than a bit diameter apart sweep disjoint
// stock, so cutting one first leaves the other's cut unchanged.
function sharesNoStockWithEarlier(
  box: Box,
  position: number,
  boxes: ReadonlyArray<Box | null>,
  waiting: ReadonlyArray<number>,
  diameter: number,
): boolean {
  for (let earlier = 0; earlier < position; earlier += 1) {
    const other = boxes[waiting[earlier] as number] ?? null;
    if (other === null || !(boxGap(box, other) > diameter)) return false;
  }
  return true;
}

function linkedPass(end: Vec3, pass: LevelPass, context: LinkContext): Linked | null {
  if (end.z !== pass.zMm) return null;
  const entry = entryPolyline(pass, end, context.diameter);
  const start = entry?.[0];
  if (entry === null || start === undefined) return null;
  const length = Math.hypot(start.x - end.x, start.y - end.y);
  if (length > context.diameter) return null;
  if (length > SAME_POINT_MM && !linkClearsBoundary(end, start, context.edges, context.radius)) {
    return null;
  }
  // The bit is already at depth, so a helical entry's helix has nothing to do.
  const linkedContour: CncContourPass = {
    kind: 'contour',
    zMm: pass.zMm,
    polyline: entry,
    closed: pass.closed,
    stayDownEntry: true,
  };
  if (!(length > SAME_POINT_MM)) return { link: null, pass: linkedContour };
  return {
    link: {
      kind: 'path3d',
      points: [
        { x: end.x, y: end.y, z: pass.zMm },
        { x: start.x, y: start.y, z: pass.zMm },
      ],
      closed: false,
      lateralFeed: 'plunge',
      stayDownLink: true,
    },
    pass: linkedContour,
  };
}

// The pass's path started where the bit can reach it: a closed ring from its
// point nearest the bit; an open row as planned, or reversed when only its far
// end is within reach (raster rows already alternate direction).
function entryPolyline(pass: LevelPass, end: Vec2, reach: number): ReadonlyArray<Vec2> | null {
  const polyline = pass.polyline;
  if (polyline.length < 2) return null;
  if (pass.closed) return nearestRingStart(polyline, end);
  const first = polyline[0] as Vec2;
  const last = polyline[polyline.length - 1] as Vec2;
  if (Math.hypot(first.x - end.x, first.y - end.y) <= reach) return polyline;
  if (Math.hypot(last.x - end.x, last.y - end.y) <= reach) return polyline.slice().reverse();
  return polyline;
}

// Where a cutting pass leaves the bit: level at its depth.
function passEnd(pass: LevelPass): Vec3 | null {
  const last = pass.polyline[pass.polyline.length - 1];
  return last === undefined ? null : { x: last.x, y: last.y, z: pass.zMm };
}

// Re-start a closed ring (last point repeats the first) at its point nearest
// `from`, keeping its direction.
export function nearestRingStart(ring: ReadonlyArray<Vec2>, from: Vec2): ReadonlyArray<Vec2> {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first === undefined || last === undefined) return ring;
  const closedRepeat = first.x === last.x && first.y === last.y;
  const vertices = closedRepeat ? ring.slice(0, -1) : ring.slice();
  if (vertices.length < 2) return ring;
  let bestIndex = 0;
  let bestT = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i] as Vec2;
    const b = vertices[(i + 1) % vertices.length] as Vec2;
    const t = projectionT(from, a, b);
    const distance = Math.hypot(a.x + (b.x - a.x) * t - from.x, a.y + (b.y - a.y) * t - from.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      bestT = t;
    }
  }
  const a = vertices[bestIndex] as Vec2;
  const b = vertices[(bestIndex + 1) % vertices.length] as Vec2;
  const start = snappedStart(a, b, bestT);
  const ordered: Vec2[] = [start];
  for (let k = 1; k <= vertices.length; k += 1) {
    ordered.push(vertices[(bestIndex + k) % vertices.length] as Vec2);
  }
  ordered.push(start);
  return withoutRepeats(ordered);
}

// A start within a few emit steps of a vertex becomes that vertex: a sliver
// segment would collapse at 3 decimals and push the whole ring to a finer
// coordinate format.
function snappedStart(a: Vec2, b: Vec2, t: number): Vec2 {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (t * length <= VERTEX_SNAP_MM) return a;
  if ((1 - t) * length <= VERTEX_SNAP_MM) return b;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function projectionT(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (!(lengthSq > 0)) return 0;
  return Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
}

function withoutRepeats(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const out: Vec2[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (
      previous !== undefined &&
      Math.abs(previous.x - point.x) <= SAME_POINT_MM &&
      Math.abs(previous.y - point.y) <= SAME_POINT_MM
    ) {
      continue;
    }
    out.push(point);
  }
  return out;
}

function polylineBox(points: ReadonlyArray<Vec2>): Box | null {
  if (points.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function pointBoxGap(point: Vec2, box: Box): number {
  const dx = Math.max(box.minX - point.x, 0, point.x - box.maxX);
  const dy = Math.max(box.minY - point.y, 0, point.y - box.maxY);
  return Math.hypot(dx, dy);
}

function boxGap(a: Box, b: Box): number {
  const dx = Math.max(a.minX - b.maxX, 0, b.minX - a.maxX);
  const dy = Math.max(a.minY - b.maxY, 0, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

function boundaryEdges(boundary: ReadonlyArray<Polyline>): ReadonlyArray<Edge> {
  const edges: Edge[] = [];
  for (const polyline of boundary) {
    const points = polyline.points;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i] as Vec2;
      const b = points[(i + 1) % points.length] as Vec2;
      if (a.x === b.x && a.y === b.y) continue;
      edges.push({
        a,
        b,
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
      });
    }
  }
  return edges;
}

// The link's tool centre must keep the wall radius from every boundary edge.
// Its ends lie on rings inside the pocket, so a link that keeps that clearance
// never crosses the boundary either.
function linkClearsBoundary(
  from: Vec2,
  to: Vec2,
  edges: ReadonlyArray<Edge>,
  radius: number,
): boolean {
  const required = radius - CLEARANCE_TOLERANCE_MM;
  const minX = Math.min(from.x, to.x) - required;
  const minY = Math.min(from.y, to.y) - required;
  const maxX = Math.max(from.x, to.x) + required;
  const maxY = Math.max(from.y, to.y) + required;
  for (const edge of edges) {
    if (edge.maxX < minX || edge.minX > maxX || edge.maxY < minY || edge.minY > maxY) continue;
    if (segmentDistance(from, to, edge.a, edge.b) < required) return false;
  }
  return true;
}

function segmentDistance(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): number {
  if (segmentsIntersect(p1, p2, q1, q2)) return 0;
  return Math.min(
    pointSegmentDistance(p1, q1, q2),
    pointSegmentDistance(p2, q1, q2),
    pointSegmentDistance(q1, p1, p2),
    pointSegmentDistance(q2, p1, p2),
  );
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const t = projectionT(p, a, b);
  return Math.hypot(a.x + (b.x - a.x) * t - p.x, a.y + (b.y - a.y) * t - p.y);
}

function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
