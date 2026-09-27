import type { Vec3 } from '../geometry/vec3';
import type { CncContourPass, CncPass, CncPath3dPass, Job } from '../job';
import type { Vec2 } from '../scene';
import {
  along,
  descentBudget,
  descentSteps,
  emittedDescentSteps,
  shortestFittingLength,
  type DescentBudget,
  type StepCapacity,
} from './ramp-descent-budget';

// Floating-point slack when counting how many laps or legs a ramp needs, so
// a ramp exactly one lap long is not rounded up to two.
const COUNT_EPSILON = 1e-9;
// The ECMAScript Array length limit, as tabbed-ramp-entry.ts checks it.
const MAX_ARRAY_LENGTH = 0xffff_ffff;

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
 *
 * The descent is planned in whole 0.001 mm steps, so no emitted move is
 * steeper than the angle, and fed so its Z rate stays within the plunge rate
 * (ADR-472). A path of moves too short for whole steps keeps the angle as
 * planned before rounding and is marked `entryAngleApproximate`.
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
  const goesOverAgain = pass.closed ? lengthMm < rampMm : lengthMm < rampMm / 2;
  if (!(lengthMm > 0) || (goesOverAgain && lengthMm < minPathMm)) {
    return { ...pass, entryPlunge: true };
  }
  // The level above is written at this depth: there is nothing to descend.
  if (emittedDescentSteps(fromZ, pass.zMm) < 1) return pass;
  const budget = descentBudget(stepCapacity(path, tangent), fromZ, pass.zMm, tangent);
  const points = pass.closed
    ? loopRampPoints(path, fromZ, pass.zMm, budget)
    : zigZagRampPoints(path, fromZ, pass.zMm, budget, rampMm, lengthMm);
  const ramped: CncPath3dPass = {
    kind: 'path3d',
    points,
    closed: false,
    lateralFeed: 'z-rate-capped',
    ...(budget.stepped ? {} : { entryAngleApproximate: true as const }),
  };
  return ramped;
}

// Descend round the loop from its start until the ramp reaches depth, lapping
// as often as that takes, then cut one whole lap at depth from that point.
function loopRampPoints(
  ring: ReadonlyArray<Vec2>,
  fromZ: number,
  zMm: number,
  budget: DescentBudget,
): Vec3[] {
  const last = ring.length - 1; // ring[last] repeats ring[0]
  const laps = Math.ceil(budget.total / walkCapacity(ring, budget) - COUNT_EPSILON) + 1;
  if (laps * ring.length > MAX_ARRAY_LENGTH) {
    throw new RangeError('Contour ramp point count exceeds the ECMAScript Array length limit.');
  }
  const start = ring[0] as Vec2;
  const points: Vec3[] = [at(start, fromZ)];
  let descended = 0;
  for (let index = 1; ; index = index === last ? 1 : index + 1) {
    const a = ring[index - 1] as Vec2;
    const b = ring[index] as Vec2;
    if (a.x === b.x && a.y === b.y) continue;
    const carried = budget.carries(a, b);
    if (descended + carried >= budget.total) {
      const end = budget.endFor(a, b, budget.total - descended);
      points.push(at(end, zMm));
      for (let k = index; k <= last; k += 1) points.push(at(ring[k] as Vec2, zMm));
      for (let k = 1; k < index; k += 1) points.push(at(ring[k] as Vec2, zMm));
      points.push(at(end, zMm));
      return points;
    }
    descended += carried;
    points.push(at(b, budget.zAfter(descended)));
  }
}

// Zig-zag along the path's first span, forward and back an even number of
// times so the descent lands on the start at depth, then the whole path. The
// span is the shortest whose legs can carry the descent, and each move takes
// its share of it, so each leg descends at the angle.
function zigZagRampPoints(
  path: ReadonlyArray<Vec2>,
  fromZ: number,
  zMm: number,
  budget: DescentBudget,
  rampMm: number,
  lengthMm: number,
): Vec3[] {
  const legs =
    2 *
    Math.max(
      1,
      Math.ceil(rampMm / (2 * lengthMm) - COUNT_EPSILON),
      Math.ceil(budget.total / (2 * walkCapacity(path, budget)) - COUNT_EPSILON),
    );
  if ((legs + 1) * path.length > MAX_ARRAY_LENGTH) {
    throw new RangeError('Contour ramp point count exceeds the ECMAScript Array length limit.');
  }
  const carriesDescent = (walk: ReadonlyArray<Vec2>): boolean =>
    legs * walkCapacity(walk, budget) >= budget.total;
  const span = leadingSpan(
    path,
    shortestFittingLength(lengthMm, (spanMm) => carriesDescent(leadingSpan(path, spanMm))),
  );
  // The whole path always carries the descent; a span cut a hair short of it
  // by floating point might not.
  const forward = carriesDescent(span) ? span : path;
  const back = [...forward].reverse();
  const capacity = legs * walkCapacity(forward, budget);
  const start = path[0] as Vec2;
  const points: Vec3[] = [at(start, fromZ)];
  let carried = 0;
  for (let leg = 0; leg < legs; leg += 1) {
    const walk = leg % 2 === 0 ? forward : back;
    for (let k = 1; k < walk.length; k += 1) {
      const b = walk[k] as Vec2;
      carried += budget.carries(walk[k - 1] as Vec2, b);
      points.push(at(b, budget.zAfter(budget.shareAfter(carried, capacity))));
    }
  }
  points[points.length - 1] = at(start, zMm);
  for (let k = 1; k < path.length; k += 1) points.push(at(path[k] as Vec2, zMm));
  return points;
}

// The path from its start up to `spanMm` along it.
function leadingSpan(path: ReadonlyArray<Vec2>, spanMm: number): ReadonlyArray<Vec2> {
  const span: Vec2[] = [path[0] as Vec2];
  let travelled = 0;
  for (let k = 1; k < path.length; k += 1) {
    const a = path[k - 1] as Vec2;
    const b = path[k] as Vec2;
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (segment === 0) continue;
    if (travelled + segment >= spanMm) {
      span.push(along(a, b, (spanMm - travelled) / segment));
      return span;
    }
    travelled += segment;
    span.push(b);
  }
  return span;
}

// The descent a walk's moves can carry under the budget.
function walkCapacity(walk: ReadonlyArray<Vec2>, budget: DescentBudget): number {
  let capacity = 0;
  for (let k = 1; k < walk.length; k += 1) {
    capacity += budget.carries(walk[k - 1] as Vec2, walk[k] as Vec2);
  }
  return capacity;
}

function stepCapacity(path: ReadonlyArray<Vec2>, tangent: number): StepCapacity {
  let steps = 0;
  for (let k = 1; k < path.length; k += 1) {
    steps += descentSteps(path[k - 1] as Vec2, path[k] as Vec2, tangent);
  }
  return { steps, lengthMm: pathLengthMm(path) };
}

export type RampEntryPlunges = {
  readonly layerId: string;
  readonly passes: number;
  readonly pocket: boolean;
  // Relief roughing chains (ADR-424 Amendment 1), counted apart from the
  // layer's other passes: a relief layer may set their ramp in its own field.
  readonly relief: boolean;
};

/** Per layer, the passes its ramp entry left to plunge (ADR-471), with the
 * layer's relief roughing reported on its own. */
export function rampEntryPlungesByLayer(job: Job): ReadonlyArray<RampEntryPlunges> {
  const found: RampEntryPlunges[] = [];
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    const passes = rampEntryPlungeCount(group.passes);
    if (passes === 0) continue;
    const relief = group.cutType === 'relief-rough';
    const index = found.findIndex(
      (seen) => seen.layerId === group.layerId && seen.relief === relief,
    );
    const seen = index < 0 ? undefined : found[index];
    const merged: RampEntryPlunges = {
      layerId: group.layerId,
      passes: (seen?.passes ?? 0) + passes,
      pocket: (seen?.pocket ?? false) || group.cutType === 'pocket',
      relief,
    };
    if (index < 0) found.push(merged);
    else found[index] = merged;
  }
  return found;
}

/** Passes a ramp entry left to plunge because their paths are too short:
 * contour ramps (ADR-471) and relief roughing chains (ADR-424 Amendment 1). */
export function rampEntryPlungeCount(passes: ReadonlyArray<CncPass>): number {
  return passes.filter((pass) => pass.kind === 'contour' && pass.entryPlunge === true).length;
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
