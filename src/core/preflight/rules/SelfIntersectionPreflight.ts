/**
 * T3-31: self-intersection detection for closed vector geometry.
 *
 * This is a warning-only preflight guard. Self-crossing paths can make fill
 * pairing, offsets, and boolean operations produce invalid output. Repairing
 * those paths is future geometry work; this rule stops the failure from being
 * silent.
 */
import type { Point } from '../../types';
import type { SceneObject, SubPath } from '../../scene/SceneObject';
import { subPathToPoints } from '../../job/JobCompiler';
import type { PreflightContext, PreflightResult } from '../Preflight';
import { PREFLIGHT_CODES } from '../Preflight';

const EPS = 1e-9;
const PATH_FLATTEN_TOLERANCE_MM = 0.05;

export function runSelfIntersectionChecks(
  ctx: PreflightContext,
  out: PreflightResult[],
): void {
  for (const obj of ctx.scene.objects) {
    if (!obj.visible) continue;
    const layer = ctx.scene.layers.find(l => l.id === obj.layerId);
    if (layer && (!layer.visible || layer.output === false)) continue;
    if (!objectHasSelfIntersection(obj)) continue;

    out.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.GEOMETRY_SELF_INTERSECTION,
      objectId: obj.id,
      layerId: obj.layerId,
      message:
        `Object "${obj.name || obj.id}" appears to self-intersect. ` +
        'Fill, offset, and cut planning can produce incorrect output for self-crossing geometry. ' +
        'Simplify or repair the path before running the job.',
    });
  }
}

export function objectHasSelfIntersection(obj: SceneObject): boolean {
  const geom = obj.geometry;
  if (geom.type === 'polygon') {
    return geom.closed && hasSelfIntersection(
      geom.points.map(point => applyObjectTransform(point, obj)),
      true,
    );
  }

  if (geom.type === 'path') {
    return geom.subPaths.some(subPathHasSelfIntersection(obj));
  }

  return false;
}

function subPathHasSelfIntersection(obj: SceneObject): (subPath: SubPath) => boolean {
  return subPath => {
    if (!subPath.closed) return false;
    const points = subPathToPoints(subPath.segments, PATH_FLATTEN_TOLERANCE_MM)
      .map(point => applyObjectTransform(point, obj));
    return hasSelfIntersection(points, true);
  };
}

export function hasSelfIntersection(points: Point[], closed: boolean): boolean {
  const normalized = normalizePoints(points);
  if (normalized.length < 4) return false;

  const edgeCount = closed ? normalized.length : normalized.length - 1;
  for (let i = 0; i < edgeCount; i++) {
    const a = normalized[i];
    const b = normalized[(i + 1) % normalized.length];
    if (samePoint(a, b)) continue;

    for (let j = i + 1; j < edgeCount; j++) {
      if (areAdjacentEdges(i, j, edgeCount, closed)) continue;
      const c = normalized[j];
      const d = normalized[(j + 1) % normalized.length];
      if (samePoint(c, d)) continue;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }

  return false;
}

function normalizePoints(points: Point[]): Point[] {
  const finite = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finite.length > 1 && samePoint(finite[0], finite[finite.length - 1])) {
    return finite.slice(0, -1);
  }
  return finite;
}

function areAdjacentEdges(i: number, j: number, edgeCount: number, closed: boolean): boolean {
  if (Math.abs(i - j) <= 1) return true;
  return closed && i === 0 && j === edgeCount - 1;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  if (!boundsOverlap(a, b, c, d)) return false;
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 * o2 < -EPS && o3 * o4 < -EPS) return true;
  if (Math.abs(o1) <= EPS && onSegment(a, c, b)) return true;
  if (Math.abs(o2) <= EPS && onSegment(a, d, b)) return true;
  if (Math.abs(o3) <= EPS && onSegment(c, a, d)) return true;
  if (Math.abs(o4) <= EPS && onSegment(c, b, d)) return true;
  return false;
}

function boundsOverlap(a: Point, b: Point, c: Point, d: Point): boolean {
  return (
    Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) + EPS &&
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) + EPS
  );
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, p: Point, b: Point): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS &&
    p.y <= Math.max(a.y, b.y) + EPS
  );
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;
}

function applyObjectTransform(point: Point, obj: SceneObject): Point {
  const t = obj.transform;
  return {
    x: t.a * point.x + t.c * point.y + t.tx,
    y: t.b * point.x + t.d * point.y + t.ty,
  };
}
