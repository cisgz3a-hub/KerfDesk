// Copy Along Path (LightBurn gap LBG-T09): where each copy of the artwork sits
// on a guide path, and which way it turns. Pure layout maths in world
// millimetres; the store action copies the artwork to these placements.
//
// Distances are measured along the guide from its start. Each copy's bounding
// box centre lands on the guide. A closed guide is spread all the way round
// with no doubled copy where its start meets its end; an open guide runs from
// the start offset to the end offset.

import type { ArrayPlacement } from '../scene/array-layout';
import type { Bounds, Vec2 } from '../scene/scene-object';
import { pointAtDistance, type PathWalk } from './path-walk';

/** Place a number of copies, copies a set distance apart centre to centre, or a set gap apart edge to edge. */
export type CopyAlongPathMode = 'count' | 'spacing' | 'gap';

export type CopyAlongPathSpec = {
  readonly mode: CopyAlongPathMode;
  /** How many copies, for 'count'. */
  readonly count: number;
  /** Centre-to-centre distance for 'spacing', or the gap between copy edges for 'gap', in mm. */
  readonly spacingMm: number;
  readonly startOffsetMm: number;
  /** Open guides only: a closed guide has no end. */
  readonly endOffsetMm: number;
  /** Turn each copy by the direction of the guide where it sits. */
  readonly rotateCopies: boolean;
};

export type CopyAlongPathGuidePath = {
  readonly walk: PathWalk;
  readonly closed: boolean;
};

export type CopyAlongPathLayout =
  | {
      readonly kind: 'placed';
      readonly placements: ReadonlyArray<ArrayPlacement>;
      /** Centre-to-centre distance when every copy is the same distance apart. */
      readonly stepMm: number | null;
    }
  | CopyAlongPathShortfall;

/** How many copies a layout has and how far apart, without the copies themselves. */
export type CopyAlongPathCount =
  | {
      readonly kind: 'counted';
      readonly count: number;
      /** Centre-to-centre distance when every copy is the same distance apart. */
      readonly stepMm: number | null;
    }
  | CopyAlongPathShortfall;

export type CopyAlongPathShortfall =
  /** The offsets leave no room on an open guide. */
  | { readonly kind: 'no-room' }
  /** The spacing or gap would pile every copy on one point. */
  | { readonly kind: 'no-step' }
  /** More copies than the caller said it can take. */
  | { readonly kind: 'too-many' };

// Rounding slack for "fits exactly": a 100 mm guide takes a copy every 25 mm
// at 0, 25, 50, 75 and 100.
const FIT_EPS_MM = 1e-6;
// Copies closer than this along the guide are one pile, not a row.
const MIN_STEP_MM = 1e-3;

// The copies as a count and the distance of each along the guide: the count
// modes work each distance out on request, so a count costs nothing to hold.
type Distances =
  | {
      readonly kind: 'ok';
      readonly count: number;
      readonly at: (index: number) => number;
    }
  | CopyAlongPathShortfall;

type Resolved = Extract<Distances, { kind: 'ok' }> & { readonly along: AlongPath };

/**
 * Lay out the copies. `maxCopies` is the most the caller can take: a layout
 * that needs more comes back as 'too-many' before anything is laid out, and a
 * spacing or gap stops stepping there however long the guide is.
 */
export function copyAlongPathLayout(
  guide: CopyAlongPathGuidePath,
  source: Bounds,
  spec: CopyAlongPathSpec,
  maxCopies: number = Number.POSITIVE_INFINITY,
): CopyAlongPathLayout {
  const resolved = resolveCopies(guide, source, spec, maxCopies);
  if (resolved.kind !== 'ok') return resolved;
  const centre = { x: (source.minX + source.maxX) / 2, y: (source.minY + source.maxY) / 2 };
  return {
    kind: 'placed',
    placements: Array.from({ length: resolved.count }, (_, index) =>
      placementAt(guide, resolved.along.wrap(resolved.at(index)), centre, spec.rotateCopies),
    ),
    stepMm: uniformStep(resolved, spec),
  };
}

/**
 * How many copies `copyAlongPathLayout` would place, and how far apart, without
 * laying any of them out: the same answer for the cost of finding the count.
 */
export function copyAlongPathCount(
  guide: CopyAlongPathGuidePath,
  source: Bounds,
  spec: CopyAlongPathSpec,
  maxCopies: number = Number.POSITIVE_INFINITY,
): CopyAlongPathCount {
  const resolved = resolveCopies(guide, source, spec, maxCopies);
  if (resolved.kind !== 'ok') return resolved;
  return { kind: 'counted', count: resolved.count, stepMm: uniformStep(resolved, spec) };
}

function resolveCopies(
  guide: CopyAlongPathGuidePath,
  source: Bounds,
  spec: CopyAlongPathSpec,
  maxCopies: number,
): Resolved | CopyAlongPathShortfall {
  const along = alongPath(guide, source, spec);
  const result = guide.closed ? closedDistances(along, maxCopies) : openDistances(along, maxCopies);
  return result.kind === 'ok' ? { ...result, along } : result;
}

/** The direction of travel at a distance along the walk: the edge leaving that point, or the last edge at the very end. */
export function tangentAtDistance(walk: PathWalk, distanceMm: number): Vec2 {
  const { points, cumulative } = walk;
  const last = points.length - 1;
  let edge = last;
  if ((cumulative[last] ?? 0) > distanceMm + FIT_EPS_MM) {
    let low = 1;
    let high = last;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((cumulative[mid] ?? 0) > distanceMm + FIT_EPS_MM) high = mid;
      else low = mid + 1;
    }
    edge = low;
  }
  // At the very end, step back over any repeated closing points.
  while (edge > 1 && (cumulative[edge] ?? 0) - (cumulative[edge - 1] ?? 0) <= 0) edge -= 1;
  const a = points[edge - 1] as Vec2;
  const b = points[edge] as Vec2;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length > 0 ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length } : { x: 1, y: 0 };
}

type AlongPath = {
  readonly spec: CopyAlongPathSpec;
  readonly lengthMm: number;
  readonly startMm: number;
  readonly wrap: (distanceMm: number) => number;
  /** Least centre-to-centre distance between copies at these two distances. */
  readonly minStep: (from: number, to: number) => number;
};

function alongPath(
  guide: CopyAlongPathGuidePath,
  source: Bounds,
  spec: CopyAlongPathSpec,
): AlongPath {
  const lengthMm = guide.walk.lengthMm;
  const wrap = (distance: number): number => {
    if (!guide.closed) return distance;
    const wrapped = distance % lengthMm;
    return wrapped > lengthMm - FIT_EPS_MM ? 0 : wrapped;
  };
  const spacing = finite(spec.spacingMm);
  const extent = (distance: number): number =>
    extentAlongPath(source, tangentAtDistance(guide.walk, wrap(distance)), spec.rotateCopies);
  const minStep =
    spec.mode === 'gap'
      ? (from: number, to: number) => Math.max(0, spacing) + (extent(from) + extent(to)) / 2
      : () => spacing;
  const startMm = Math.max(0, finite(spec.startOffsetMm));
  return { spec, lengthMm, startMm: guide.closed ? wrap(startMm) : startMm, wrap, minStep };
}

// How far the copy reaches along the guide: its width when it turns with the
// guide, otherwise the width of its upright box seen along the travel direction.
function extentAlongPath(source: Bounds, tangent: Vec2, rotateCopies: boolean): number {
  const width = Math.max(0, source.maxX - source.minX);
  const height = Math.max(0, source.maxY - source.minY);
  return rotateCopies ? width : Math.abs(width * tangent.x) + Math.abs(height * tangent.y);
}

function openDistances(along: AlongPath, maxCopies: number): Distances {
  const start = along.startMm;
  const end = along.lengthMm - Math.max(0, finite(along.spec.endOffsetMm));
  const span = end - start;
  if (span < -FIT_EPS_MM) return { kind: 'no-room' };
  if (along.spec.mode === 'count') {
    const count = positiveCount(along.spec.count);
    if (count > maxCopies) return { kind: 'too-many' };
    if (count === 1) return { kind: 'ok', count, at: () => start };
    if (span < MIN_STEP_MM) return { kind: 'no-room' };
    return { kind: 'ok', count, at: (index) => start + (span * index) / (count - 1) };
  }
  return stepAlong(along, start, (next) => next <= end + FIT_EPS_MM, maxCopies);
}

function closedDistances(along: AlongPath, maxCopies: number): Distances {
  const start = along.startMm;
  const length = along.lengthMm;
  if (along.spec.mode === 'count') {
    const count = positiveCount(along.spec.count);
    if (count > maxCopies) return { kind: 'too-many' };
    return { kind: 'ok', count, at: (index) => start + (length * index) / count };
  }
  // The last copy keeps at least the asked-for distance from the first one
  // round the seam; whatever is left over goes into that last space.
  const seam = start + length;
  return stepAlong(
    along,
    start,
    (next) => seam - next >= along.minStep(next, seam) - FIT_EPS_MM,
    maxCopies,
  );
}

// Steps until the next copy no longer fits, or until there would be more
// copies than the caller can take, so a tiny spacing on a long guide costs as
// much as the copies it may have and no more.
function stepAlong(
  along: AlongPath,
  start: number,
  fits: (next: number) => boolean,
  maxCopies: number,
): Distances {
  if (maxCopies < 1) return { kind: 'too-many' };
  const distances = [start];
  let current = start;
  for (;;) {
    const next = nextDistance(along, current);
    if (next - current < MIN_STEP_MM) return { kind: 'no-step' };
    if (!fits(next))
      return { kind: 'ok', count: distances.length, at: (index) => distances[index] ?? 0 };
    if (distances.length >= maxCopies) return { kind: 'too-many' };
    distances.push(next);
    current = next;
  }
}

// The next centre: far enough that the two copies keep the spacing or gap.
// With a gap and upright copies, the next copy's reach depends on where it
// lands, so the guess is refined twice.
function nextDistance(along: AlongPath, current: number): number {
  let next = current + along.minStep(current, current);
  if (along.spec.mode !== 'gap') return next;
  for (let pass = 0; pass < 2; pass += 1) next = current + along.minStep(current, next);
  return next;
}

function placementAt(
  guide: CopyAlongPathGuidePath,
  distance: number,
  centre: Vec2,
  rotateCopies: boolean,
): ArrayPlacement {
  const point = pointAtDistance(guide.walk, distance);
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  if (!rotateCopies) return { dx, dy, rotationDeg: 0 };
  const tangent = tangentAtDistance(guide.walk, distance);
  const rotationDeg = normalizeDegrees((Math.atan2(tangent.y, tangent.x) * 180) / Math.PI);
  return rotationDeg === 0 ? { dx, dy, rotationDeg: 0 } : { dx, dy, rotationDeg, pivot: point };
}

// Upright copies kept a gap apart reach further along a diagonal than along a
// straight run, so only then does the centre distance vary.
function uniformStep(distances: Resolved, spec: CopyAlongPathSpec): number | null {
  if (distances.count < 2) return null;
  if (spec.mode === 'gap' && !spec.rotateCopies) return null;
  return distances.at(1) - distances.at(0);
}

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function positiveCount(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
