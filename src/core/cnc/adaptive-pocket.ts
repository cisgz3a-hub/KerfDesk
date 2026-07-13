import {
  EndType,
  FillRule,
  inflatePathsD,
  isPositiveD,
  JoinType,
  unionD,
  type PathD,
  type PathsD,
} from 'clipper2-ts';
import { tryVectorOp } from '../geometry/vector-path-tools';
import type { Polyline, Vec2 } from '../scene';
import { filletClosedCorners } from './adaptive-corner-fillet';

export type AdaptivePocketSequence = {
  readonly entryCenter: Vec2;
  readonly entryRadiusMm: number;
  readonly finishRings: ReadonlyArray<Polyline>;
  readonly rings: ReadonlyArray<Polyline>;
};

export type AdaptivePocketPlan =
  | {
      readonly ok: true;
      readonly sequences: ReadonlyArray<AdaptivePocketSequence>;
      readonly optimalLoadMm: number;
    }
  | { readonly ok: false; readonly reason: string };

const MIN_POINTS = 3;
const MAX_LEVELS = 4096;
const PRECISION_DECIMALS = 3;
const ENTRY_GRID = 24;
const ENTRY_REFINEMENTS = 4;
const EPSILON = 1e-9;

export function planAdaptivePocket(
  contours: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  optimalLoadMm: number,
): AdaptivePocketPlan {
  const issue = requestIssue(contours, toolDiameterMm, optimalLoadMm);
  if (issue !== null) return { ok: false, reason: issue };
  if (hasNestedContours(contours)) {
    return {
      ok: false,
      reason:
        'Adaptive clearing currently requires island-free pockets; use Offset rings for island pockets.',
    };
  }
  const original = runClipper(() => unionD(toPaths(contours), FillRule.EvenOdd));
  if (original === null || original.length === 0) {
    return { ok: false, reason: 'Adaptive clearing could not build a closed pocket region.' };
  }
  if (original.some((path) => !isPositiveD(path))) {
    return {
      ok: false,
      reason:
        'Adaptive clearing currently requires island-free pockets; use Offset rings for island pockets.',
    };
  }
  const components = componentRegions(original);
  const sequences: AdaptivePocketSequence[] = [];
  for (const component of components) {
    const sequence = sequenceForComponent(component, toolDiameterMm, optimalLoadMm);
    if (!sequence.ok) return sequence;
    sequences.push(sequence.value);
  }
  return sequences.length === 0
    ? { ok: false, reason: 'Adaptive clearing found no reachable pocket area.' }
    : { ok: true, sequences, optimalLoadMm };
}

type SequenceResult =
  | { readonly ok: true; readonly value: AdaptivePocketSequence }
  | { readonly ok: false; readonly reason: string };

function sequenceForComponent(
  component: PathsD,
  toolDiameterMm: number,
  optimalLoadMm: number,
): SequenceResult {
  const toolRadius = toolDiameterMm / 2;
  const centerRegion = offset(component, -toolRadius);
  if (centerRegion === null || centerRegion.length === 0) {
    return { ok: false, reason: 'The selected bit does not fit one of the adaptive pockets.' };
  }
  const entry = maximumClearancePoint(centerRegion);
  if (entry === null) {
    return { ok: false, reason: 'Adaptive clearing could not find a safe entry cavity.' };
  }
  const entryRadiusMm = Math.min(toolRadius * 0.75, entry.clearanceMm * 0.8);
  if (entryRadiusMm < Math.min(toolRadius * 0.2, optimalLoadMm)) {
    return {
      ok: false,
      reason: 'The pocket has no entry cavity large enough for adaptive clearing.',
    };
  }
  const levels = offsetLevels(centerRegion, optimalLoadMm / 2);
  if (levels === null) {
    return { ok: false, reason: 'Adaptive clearing geometry could not be calculated safely.' };
  }
  const rings = alignRingStarts(
    [...levels]
      .reverse()
      .flatMap((level) => level.map((path) => toAdaptivePolyline(path, toolRadius))),
    entry.point,
  );
  return {
    ok: true,
    value: {
      entryCenter: entry.point,
      entryRadiusMm,
      finishRings: centerRegion.map(toPolyline),
      rings,
    },
  };
}

function offsetLevels(centerRegion: PathsD, optimalLoadMm: number): PathsD[] | null {
  const levels: PathsD[] = [];
  for (let index = 0; index < MAX_LEVELS; index += 1) {
    const level = index === 0 ? centerRegion : offset(centerRegion, -index * optimalLoadMm);
    if (level === null) return null;
    if (level.length === 0) break;
    levels.push(level);
  }
  return levels;
}

function componentRegions(region: PathsD): ReadonlyArray<PathsD> {
  const outers = region.filter((path) => isPositiveD(path));
  const holes = region.filter((path) => !isPositiveD(path));
  return outers.map((outer) => [
    outer,
    ...holes.filter((hole) => {
      const probe = hole[0];
      return probe !== undefined && pointInPath(probe, outer);
    }),
  ]);
}

type ClearancePoint = { readonly point: Vec2; readonly clearanceMm: number };

function maximumClearancePoint(region: PathsD): ClearancePoint | null {
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

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

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

function alignRingStarts(
  rings: ReadonlyArray<Polyline>,
  initialPoint: Vec2,
): ReadonlyArray<Polyline> {
  const out: Polyline[] = [];
  let previous = initialPoint;
  for (const ring of rings) {
    const rotated = rotateClosedRingToNearest(ring, previous);
    out.push(rotated);
    previous = rotated.points[0] ?? previous;
  }
  return out;
}

function rotateClosedRingToNearest(ring: Polyline, point: Vec2): Polyline {
  const points = withoutDuplicateClosure(ring.points);
  if (points.length < 2) return ring;
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const candidate = points[index];
    if (candidate === undefined) continue;
    const nextDistance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (nextDistance < distance) {
      distance = nextDistance;
      nearest = index;
    }
  }
  const rotated = [...points.slice(nearest), ...points.slice(0, nearest)];
  const first = rotated[0];
  return { closed: true, points: first === undefined ? rotated : [...rotated, first] };
}

function requestIssue(
  contours: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  optimalLoadMm: number,
): string | null {
  if (!positiveFinite(toolDiameterMm) || !positiveFinite(optimalLoadMm)) {
    return 'Adaptive bit diameter and optimal load must be positive and finite.';
  }
  if (optimalLoadMm > toolDiameterMm / 2) {
    return 'Adaptive optimal load must not exceed half the bit diameter.';
  }
  return contours.some((contour) => !contour.closed || contour.points.length < MIN_POINTS)
    ? 'Adaptive clearing requires closed pocket contours.'
    : null;
}

function hasNestedContours(contours: ReadonlyArray<Polyline>): boolean {
  return contours.some((contour, index) => {
    const probe = contour.points[0];
    return (
      probe !== undefined &&
      contours.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index && pointInPath(probe, toPaths([candidate])[0] ?? []),
      )
    );
  });
}

function offset(paths: PathsD, deltaMm: number): PathsD | null {
  return runClipper(() =>
    inflatePathsD(paths, deltaMm, JoinType.Round, EndType.Polygon, 2, PRECISION_DECIMALS),
  );
}

function runClipper(operation: () => PathsD): PathsD | null {
  const result = tryVectorOp(operation);
  return result.kind === 'ok' ? result.value : null;
}

function toPaths(polylines: ReadonlyArray<Polyline>): PathsD {
  return polylines.map((polyline) =>
    withoutDuplicateClosure(polyline.points).map((point) => ({ ...point })),
  );
}

function toPolyline(path: PathD): Polyline {
  const points = path.map((point) => ({ x: clean(point.x), y: clean(point.y) }));
  const first = points[0];
  return { closed: true, points: first === undefined ? points : [...points, first] };
}

function toAdaptivePolyline(path: PathD, cornerRadiusMm: number): Polyline {
  const polyline = toPolyline(path);
  return isPositiveD(path) ? filletClosedCorners(polyline, cornerRadiusMm) : polyline;
}

function withoutDuplicateClosure(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points[points.length - 1];
  return first !== undefined && last !== undefined && pointsEqual(first, last)
    ? points.slice(0, -1)
    : points;
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

function pointInPath(point: Vec2, path: PathD): boolean {
  let inside = false;
  for (let index = 0, previous = path.length - 1; index < path.length; previous = index++) {
    const a = path[index];
    const b = path[previous];
    if (a === undefined || b === undefined || a.y > point.y === b.y > point.y) continue;
    const crossingX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

function minimumEdgeDistance(point: Vec2, paths: PathsD): number {
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

function pointsEqual(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clean(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
