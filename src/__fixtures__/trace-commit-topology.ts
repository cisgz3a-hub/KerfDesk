import { isDeepStrictEqual } from 'node:util';
import type { Polyline, Vec2 } from '../core/scene';

type Box = { minX: number; minY: number; maxX: number; maxY: number };
type Boundary = Box & { before: Polyline; after: Polyline; changed: boolean };
type Edge = Box & { from: Vec2; to: Vec2; index: number };

export type TraceCommitTopology = {
  closedLoops: number;
  changedWinding: number;
  newSelfIntersections: number;
  newIntersectingPairs: number;
  changedContainment: number;
};

/** Independent winding, proper-crossing and ray predicates. Does not call
 * the production contour repair or its membership/intersection helpers.
 * Native curves are compared using the same compiled baseline on both sides.
 * Inherited proper intersections are allowed, but new intersecting pairs are not. */
export function traceCommitTopology(
  before: readonly Polyline[],
  after: readonly Polyline[],
): TraceCommitTopology {
  const result: TraceCommitTopology = {
    closedLoops: 0,
    changedWinding: 0,
    newSelfIntersections: 0,
    newIntersectingPairs: 0,
    changedContainment: 0,
  };
  const boundaries: Boundary[] = [];
  before.forEach((source, index) => {
    const saved = after[index];
    if (!source.closed || saved === undefined) return;
    result.closedLoops += 1;
    const changed = !isDeepStrictEqual(source, saved);
    result.changedWinding += Number(winding(source) !== winding(saved));
    if (changed && intersects(saved, saved) && !intersects(source, source))
      result.newSelfIntersections += 1;
    boundaries.push({
      ...bounds([...source.points, ...saved.points]),
      before: source,
      after: saved,
      changed,
    });
  });
  boundaries.sort((a, b) => a.minX - b.minX);
  boundaries.forEach((a, index) => {
    for (let next = index + 1; next < boundaries.length; next += 1) {
      const b = boundaries[next] as Boundary;
      if (b.minX > a.maxX) break;
      if (!a.changed && !b.changed) continue;
      if (!overlaps(a, b)) continue;
      if (intersects(a.after, b.after) && !intersects(a.before, b.before)) {
        result.newIntersectingPairs += 1;
      }
      result.changedContainment += Number(
        membership(a.before, b.before) !== membership(a.after, b.after),
      );
      result.changedContainment += Number(
        membership(b.before, a.before) !== membership(b.after, a.after),
      );
    }
  });
  return result;
}

function bounds(points: readonly Vec2[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const point of points) {
    box.minX = Math.min(box.minX, point.x);
    box.minY = Math.min(box.minY, point.y);
    box.maxX = Math.max(box.maxX, point.x);
    box.maxY = Math.max(box.maxY, point.y);
  }
  return box;
}

function overlaps(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

function edges(polyline: Polyline): Edge[] {
  const result: Edge[] = [];
  for (let index = 0; index < polyline.points.length; index += 1) {
    const from = polyline.points[index] as Vec2;
    const to = polyline.points[(index + 1) % polyline.points.length] as Vec2;
    if (from.x === to.x && from.y === to.y) continue;
    result.push({ ...bounds([from, to]), from, to, index });
  }
  return result.sort((a, b) => a.minX - b.minX);
}

function turn(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function properCrossing(a: Edge, b: Edge): boolean {
  return (
    turn(a.from, a.to, b.from) * turn(a.from, a.to, b.to) < 0 &&
    turn(b.from, b.to, a.from) * turn(b.from, b.to, a.to) < 0
  );
}

function intersects(a: Polyline, b: Polyline): boolean {
  const ordered = edges(a).map((edge) => ({ ...edge, side: 0 }));
  if (a !== b) ordered.push(...edges(b).map((edge) => ({ ...edge, side: 1 })));
  ordered.sort((first, second) => first.minX - second.minX);
  let active: typeof ordered = [];
  for (const edge of ordered) {
    active = active.filter((candidate) => candidate.maxX >= edge.minX);
    for (const candidate of active) {
      if (a !== b && candidate.side === edge.side) continue;
      if (overlaps(edge, candidate) && properCrossing(edge, candidate)) return true;
    }
    active.push(edge);
  }
  return false;
}

function winding(polyline: Polyline): number {
  const origin = polyline.points[0];
  if (origin === undefined) return 0;
  let area = 0;
  for (let index = 1; index + 1 < polyline.points.length; index += 1) {
    area += turn(origin, polyline.points[index] as Vec2, polyline.points[index + 1] as Vec2);
  }
  return Math.sign(area);
}

function membership(inner: Polyline, outer: Polyline): boolean {
  const point = inner.points[0];
  if (point === undefined) return false;
  let inside = false;
  for (
    let index = 0, previous = outer.points.length - 1;
    index < outer.points.length;
    previous = index++
  ) {
    const a = outer.points[index] as Vec2;
    const b = outer.points[previous] as Vec2;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
