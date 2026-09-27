import type { Vec3 } from '../geometry/vec3';
import type { CncContourPass, CncPass, CncPath3dPass, Job } from '../job';
import type { Vec2 } from '../scene';
import {
  assertRampPointCount,
  rampCapacities,
  rampDepth,
  rampDescentSteps,
  rampSegmentEnd,
  rampZ,
  type RampDepth,
} from './contour-ramp-precision';

/**
 * Enter a contour pass by descending along its own path from `fromZ` to the
 * pass depth, at most `tangent` mm down per mm of travel (F-CNC18).
 *
 * - A closed loop is descended round from its start, lap after lap when it is
 *   shorter than its ramp, then cut one whole lap at depth from where the
 *   descent ended, so it ends level all round.
 * - An open path cannot be lapped. It zig-zags along its first span (the whole
 *   path when that is short) back to its start at depth, then cuts the whole
 *   path at depth, so no sloped floor stays behind.
 * - A path the ramp would have to go over again that is shorter than
 *   `minPathMm` (one cut width) keeps its plunge: the cutter's footprint then
 *   covers the whole path, so going round it again would only be a slower
 *   plunge. It stays a contour pass marked `entryPlunge`, which the G-code
 *   header and Job Review disclose.
 */
export function rampContourPass(
  pass: CncContourPass,
  fromZ: number,
  tangent: number,
  minPathMm: number,
): CncPass {
  const drop = fromZ - pass.zMm;
  // Already cut this deep, no ramp asked for, or no path to enter.
  if (!(drop > 0) || !(tangent > 0) || pass.polyline.length === 0) return pass;
  const rampMm = drop / tangent;
  const path = pass.closed ? closedRing(pass.polyline) : pass.polyline;
  const lengthMm = pathLengthMm(path);
  if (keepShortPathPlunge(pass.closed, lengthMm, rampMm, minPathMm)) {
    return { ...pass, entryPlunge: true };
  }
  const depth = rampDepth(fromZ, pass.zMm);
  if (depth === null) return precisionPlunge(pass);
  if (depth.dropQuanta <= 0) return pass;
  const capacities = rampCapacities(path, tangent, depth.dropQuanta);
  if (!capacities.some((capacity) => capacity > 0)) return precisionPlunge(pass);
  const points = pass.closed
    ? loopRampPoints(path, depth, capacities, tangent)
    : zigZagRampPoints(path, depth, capacities, tangent);
  const ramped: CncPath3dPass = {
    kind: 'path3d',
    points,
    closed: false,
    entryRamp: true,
    lateralFeed: 'z-rate-capped',
  };
  return ramped;
}

function keepShortPathPlunge(
  closed: boolean,
  lengthMm: number,
  rampMm: number,
  minPathMm: number,
): boolean {
  const goesOverAgain = closed ? lengthMm < rampMm : lengthMm < rampMm / 2;
  return !(lengthMm > 0) || (goesOverAgain && lengthMm < minPathMm);
}

function precisionPlunge(pass: CncContourPass): CncContourPass {
  return { ...pass, entryPlunge: true, entryPlungeReason: 'coordinate-precision' };
}

// Descend round the loop from its start until the ramp reaches depth, lapping
// as often as that takes, then cut one whole lap at depth from that point.
function loopRampPoints(
  ring: ReadonlyArray<Vec2>,
  depth: RampDepth,
  capacities: ReadonlyArray<number>,
  tangent: number,
): Vec3[] {
  const last = ring.length - 1; // ring[last] repeats ring[0]
  const start = ring[0] as Vec2;
  const capacity = capacities.reduce((sum, value) => sum + value, 0);
  assertRampPointCount((Math.ceil(depth.dropQuanta / capacity) + 1) * last + 2);
  const points: Vec3[] = [at(start, rampZ(depth.fromQuanta))];
  const zMm = rampZ(depth.targetQuanta);
  let remaining = depth.dropQuanta;
  for (let index = 1; ; index = index === last ? 1 : index + 1) {
    const a = ring[index - 1] as Vec2;
    const b = ring[index] as Vec2;
    const step = capacities[index - 1] ?? 0;
    if (step >= remaining) {
      const end = rampSegmentEnd(a, b, tangent, remaining);
      points.push({ x: end.x, y: end.y, z: zMm });
      for (let k = index; k <= last; k += 1) points.push(at(ring[k] as Vec2, zMm));
      for (let k = 1; k < index; k += 1) points.push(at(ring[k] as Vec2, zMm));
      points.push({ x: end.x, y: end.y, z: zMm });
      return points;
    }
    remaining -= step;
    points.push(at(b, rampZ(depth.targetQuanta + remaining)));
  }
}

// Zig-zag along the path's first span, forward and back an even number of
// times so the descent lands on the start at depth, then the whole path. The
// legs share the integer descent. Each segment stays inside its translated
// output-coordinate budget; the complete source path is then cut at depth.
function zigZagRampPoints(
  path: ReadonlyArray<Vec2>,
  depth: RampDepth,
  capacities: ReadonlyArray<number>,
  tangent: number,
): Vec3[] {
  const forward = leadingSpan(path, capacities, Math.ceil(depth.dropQuanta / 2), tangent);
  const forwardCapacities = rampCapacities(forward, tangent, depth.dropQuanta);
  const capacity = forwardCapacities.reduce((sum, value) => sum + value, 0);
  const legs = 2 * Math.max(1, Math.ceil(depth.dropQuanta / (2 * capacity)));
  assertRampPointCount(legs * (forward.length - 1) + path.length);
  const walks = [forward, [...forward].reverse()] as const;
  const budgets = [forwardCapacities, [...forwardCapacities].reverse()] as const;
  const start = path[0] as Vec2;
  const points: Vec3[] = [at(start, rampZ(depth.fromQuanta))];
  let remaining = depth.dropQuanta;
  for (let leg = 0; leg < legs; leg += 1) {
    const direction = leg % 2;
    const walk = walks[direction] as ReadonlyArray<Vec2>;
    const steps = rampDescentSteps(
      budgets[direction] as ReadonlyArray<number>,
      Math.ceil(remaining / (legs - leg)),
    );
    for (let k = 1; k < walk.length; k += 1) {
      const b = walk[k] as Vec2;
      remaining -= steps[k - 1] ?? 0;
      points.push(at(b, rampZ(depth.targetQuanta + remaining)));
    }
  }
  for (let k = 1; k < path.length; k += 1)
    points.push(at(path[k] as Vec2, rampZ(depth.targetQuanta)));
  return points;
}

// The shortest source-path prefix with enough representable descent for one leg.
function leadingSpan(
  path: ReadonlyArray<Vec2>,
  capacities: ReadonlyArray<number>,
  wanted: number,
  tangent: number,
): ReadonlyArray<Vec2> {
  const span: Vec2[] = [path[0] as Vec2];
  let remaining = wanted;
  for (let k = 1; k < path.length; k += 1) {
    const a = path[k - 1] as Vec2;
    const b = path[k] as Vec2;
    const capacity = capacities[k - 1] ?? 0;
    if (capacity >= remaining) {
      span.push(rampSegmentEnd(a, b, tangent, remaining));
      return span;
    }
    remaining -= capacity;
    span.push(b);
  }
  return span;
}

export type RampEntryPlunges = {
  readonly layerId: string;
  readonly passes: number;
  readonly pocket: boolean;
  readonly coordinatePrecisionPasses?: number;
};

/** Per layer, the passes its ramp entry left to plunge (ADR-471). */
export function rampEntryPlungesByLayer(job: Job): ReadonlyArray<RampEntryPlunges> {
  const byLayer = new Map<string, RampEntryPlunges>();
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    const passes = rampEntryPlungeCount(group.passes);
    if (passes === 0) continue;
    const seen = byLayer.get(group.layerId);
    const coordinatePrecisionPasses =
      (seen?.coordinatePrecisionPasses ?? 0) +
      group.passes.filter(
        (pass) =>
          (pass.kind === 'contour' || pass.kind === 'path3d') &&
          pass.entryPlunge === true &&
          pass.entryPlungeReason === 'coordinate-precision',
      ).length;
    byLayer.set(group.layerId, {
      layerId: group.layerId,
      passes: (seen?.passes ?? 0) + passes,
      pocket: (seen?.pocket ?? false) || group.cutType === 'pocket',
      ...(coordinatePrecisionPasses === 0 ? {} : { coordinatePrecisionPasses }),
    });
  }
  return [...byLayer.values()];
}

/** Passes left to plunge because of path length or emitted-coordinate precision. */
export function rampEntryPlungeCount(passes: ReadonlyArray<CncPass>): number {
  return passes.filter(
    (pass) => (pass.kind === 'contour' || pass.kind === 'path3d') && pass.entryPlunge === true,
  ).length;
}

function closedRing(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0] as Vec2;
  const last = points[points.length - 1] as Vec2;
  return first.x === last.x && first.y === last.y ? points : [...points, first];
}

function pathLengthMm(path: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let k = 1; k < path.length; k += 1) {
    const a = path[k - 1] as Vec2;
    const b = path[k] as Vec2;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

function at(point: Vec2, z: number): Vec3 {
  return { x: point.x, y: point.y, z };
}
