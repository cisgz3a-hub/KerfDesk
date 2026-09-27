// Optional SVG grouping must preserve the compound's paint. Prove simple,
// separated boundaries before applying the nesting helper's precondition.
// Uncertain topology or exhausted analysis budget keeps the original path;
// it never changes geometry or prevents export.
import { curveSubpathBounds, flattenCurveSubpath } from '../scene/curve-path';
import type { Bounds, CurveSubpath, Vec2 } from '../scene/scene-object';
import { groupContoursWithHoles, type ContourGroup } from './contour-nesting';

type Ring = { points: ReadonlyArray<Vec2>; bounds: Bounds; tolerance: number };
type Budget = { remaining: number };
const MAX_EDGE_CHECKS = 200_000;

export function provenContourGroups(
  contours: ReadonlyArray<CurveSubpath>,
): ReadonlyArray<ContourGroup> | null {
  if (contours.length < 2) return contours.map((_, outer) => ({ outer, holes: [] }));
  const budget = { remaining: MAX_EDGE_CHECKS };
  const proved: Ring[] = [];
  for (const contour of contours) {
    if (contour.segments.length > budget.remaining) return null;
    const ring = flattenRing(contour, budget.remaining);
    if (ring === null) return null;
    budget.remaining -= ring.points.length;
    proved.push(ring);
  }
  for (const [index, ring] of proved.entries()) {
    if (!separatedEdges(ring, ring, budget, true)) return null;
    for (let other = 0; other < index; other += 1) {
      if (--budget.remaining < 0) return null;
      const candidate = proved[other];
      if (candidate === undefined) return null;
      if (separateBounds(ring.bounds, candidate.bounds, 0)) continue;
      if (!separatedEdges(ring, candidate, budget, false)) return null;
    }
  }
  return groupContoursWithHoles(contours);
}

function flattenRing(curve: CurveSubpath, segmentBudget: number): Ring | null {
  const bounds = curveSubpathBounds(curve);
  if (!Object.values(bounds).every(Number.isFinite) || !curve.closed) return null;
  const size = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const tolerance = curve.segments.every((segment) => segment.kind === 'line')
    ? 0
    : Math.max(size * 1e-4, 1e-9);
  const flat = flattenCurveSubpath(curve, {
    toleranceMm: Math.max(tolerance, 1e-9),
    segmentBudget,
  });
  if (flat.kind !== 'ok') return null;
  const points = [...flat.polyline.points];
  const first = points[0],
    last = points.at(-1);
  if (first && last && first.x === last.x && first.y === last.y) points.pop();
  if (
    points.length < 3 ||
    !points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  )
    return null;
  return { points, bounds, tolerance };
}

function separatedEdges(a: Ring, b: Ring, budget: Budget, self: boolean): boolean {
  const magnitude = Math.max(
    1,
    ...Object.values(a.bounds).map(Math.abs),
    ...Object.values(b.bounds).map(Math.abs),
  );
  const margin = a.tolerance + b.tolerance + magnitude * 1e-12;
  for (let i = 0; i < a.points.length; i += 1) {
    for (let j = self ? i + 1 : 0; j < b.points.length; j += 1) {
      if (self && (j === i + 1 || (i === 0 && j === b.points.length - 1))) continue;
      if (--budget.remaining < 0) return false;
      if (!separatedPair(a, i, b, j, margin)) return false;
    }
  }
  return true;
}

function separatedPair(a: Ring, i: number, b: Ring, j: number, margin: number): boolean {
  const p = a.points[i],
    q = a.points[(i + 1) % a.points.length];
  const r = b.points[j],
    s = b.points[(j + 1) % b.points.length];
  if (p === undefined || q === undefined || r === undefined || s === undefined) return false;
  if (separateBounds(edgeBounds(p, q), edgeBounds(r, s), margin)) return true;
  const distance = Math.min(
    pointSegmentDistance(p, r, s),
    pointSegmentDistance(q, r, s),
    pointSegmentDistance(r, p, q),
    pointSegmentDistance(s, p, q),
  );
  return !crosses(p, q, r, s) && distance > margin;
}

function edgeBounds(a: Vec2, b: Vec2): Bounds {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

function separateBounds(a: Bounds, b: Bounds, margin: number): boolean {
  return (
    a.maxX + margin < b.minX ||
    b.maxX + margin < a.minX ||
    a.maxY + margin < b.minY ||
    b.maxY + margin < a.minY
  );
}

function crosses(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const ac = side(a, b, c),
    ad = side(a, b, d),
    ca = side(c, d, a),
    cb = side(c, d, b);
  if (![ac, ad, ca, cb].every(Number.isFinite)) return true;
  return Math.sign(ac) !== Math.sign(ad) && Math.sign(ca) !== Math.sign(cb);
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
