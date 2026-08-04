import type { PathsD } from 'clipper2-ts';
import type { Vec2 } from '../scene';
import { pointInPath } from './adaptive-pocket-geometry';

const ENTRY_GRID = 24;
const ENTRY_REFINEMENTS = 4;
const EPSILON = 1e-9;

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type ClearancePoint = { readonly point: Vec2; readonly clearanceMm: number };

export function maximumClearancePoint(region: PathsD): ClearancePoint | null {
  const bounds = pathBounds(region);
  if (bounds === null) return null;
  let search = bounds;
  let best: ClearancePoint | null = null;
  for (let refinement = 0; refinement <= ENTRY_REFINEMENTS; refinement += 1) {
    best = bestGridPoint(region, search, best);
    if (best === null) return null;
    const width = (search.maxX - search.minX) / ENTRY_GRID;
    const height = (search.maxY - search.minY) / ENTRY_GRID;
    search = {
      minX: best.point.x - width,
      minY: best.point.y - height,
      maxX: best.point.x + width,
      maxY: best.point.y + height,
    };
  }
  return best;
}

export function minimumEdgeDistance(point: Vec2, paths: PathsD): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const path of paths) {
    for (let index = 0; index < path.length; index += 1) {
      const start = path[index];
      const end = path[(index + 1) % path.length];
      if (start !== undefined && end !== undefined) {
        minimum = Math.min(minimum, pointToSegmentDistance(point, start, end));
      }
    }
  }
  return minimum;
}

function bestGridPoint(
  region: PathsD,
  bounds: Bounds,
  initial: ClearancePoint | null,
): ClearancePoint | null {
  let best = initial;
  for (let row = 0; row < ENTRY_GRID; row += 1) {
    for (let col = 0; col < ENTRY_GRID; col += 1) {
      const point = {
        x: bounds.minX + ((col + 0.5) / ENTRY_GRID) * (bounds.maxX - bounds.minX),
        y: bounds.minY + ((row + 0.5) / ENTRY_GRID) * (bounds.maxY - bounds.minY),
      };
      if (!pointInRegion(point, region)) continue;
      const clearanceMm = minimumEdgeDistance(point, region);
      if (best === null || clearanceMm > best.clearanceMm) best = { point, clearanceMm };
    }
  }
  return best;
}

function pathBounds(paths: PathsD): Bounds | null {
  let bounds: Bounds | null = null;
  for (const path of paths) {
    for (const point of path) {
      bounds =
        bounds === null
          ? { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
          : {
              minX: Math.min(bounds.minX, point.x),
              minY: Math.min(bounds.minY, point.y),
              maxX: Math.max(bounds.maxX, point.x),
              maxY: Math.max(bounds.maxY, point.y),
            };
    }
  }
  return bounds;
}

function pointInRegion(point: Vec2, paths: PathsD): boolean {
  let inside = false;
  for (const path of paths) if (pointInPath(point, path)) inside = !inside;
  return inside;
}

function pointToSegmentDistance(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}
