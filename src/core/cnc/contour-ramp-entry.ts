import type { Vec3 } from '../geometry/vec3';
import type { CncContourPass, CncPass, CncPath3dPass, Job } from '../job';
import type { Vec2 } from '../scene';

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
 * - `endAtStart` (a stay-down link leaves from the ring's start, ADR-491):
 *   the loop is descended into its start from one ramp length before it, so
 *   the lap at depth ends on the start instead of where the descent ended.
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
  endAtStart: boolean,
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
  const retraces = Math.ceil(rampMm / lengthMm - COUNT_EPSILON) + 1;
  if (retraces * path.length > MAX_ARRAY_LENGTH) {
    throw new RangeError('Contour ramp point count exceeds the ECMAScript Array length limit.');
  }
  const points = pass.closed
    ? endingLoopRampPoints(path, fromZ, pass.zMm, rampMm, endAtStart)
    : zigZagRampPoints(path, fromZ, pass.zMm, rampMm, lengthMm);
  const ramped: CncPath3dPass = { kind: 'path3d', points, closed: false };
  return ramped;
}

// Descend round the loop from its start until the ramp reaches depth, lapping
// as often as that takes, then cut one whole lap at depth from that point.
function loopRampPoints(
  ring: ReadonlyArray<Vec2>,
  fromZ: number,
  zMm: number,
  rampMm: number,
): Vec3[] {
  const last = ring.length - 1; // ring[last] repeats ring[0]
  const start = ring[0] as Vec2;
  const points: Vec3[] = [{ x: start.x, y: start.y, z: fromZ }];
  let travelled = 0;
  for (let index = 1; ; index = index === last ? 1 : index + 1) {
    const a = ring[index - 1] as Vec2;
    const b = ring[index] as Vec2;
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (segment === 0) continue;
    const remaining = rampMm - travelled;
    if (segment >= remaining) {
      const end = along(a, b, remaining / segment);
      points.push({ x: end.x, y: end.y, z: zMm });
      for (let k = index; k <= last; k += 1) points.push(at(ring[k] as Vec2, zMm));
      for (let k = 1; k < index; k += 1) points.push(at(ring[k] as Vec2, zMm));
      points.push({ x: end.x, y: end.y, z: zMm });
      return points;
    }
    travelled += segment;
    points.push(at(b, fromZ - (travelled / rampMm) * (fromZ - zMm)));
  }
}

// A loop ramp, or with `endAtStart` one that ends on the ring's start.
function endingLoopRampPoints(
  ring: ReadonlyArray<Vec2>,
  fromZ: number,
  zMm: number,
  rampMm: number,
  endAtStart: boolean,
): Vec3[] {
  return endAtStart
    ? loopRampIntoStart(ring, fromZ, zMm, rampMm)
    : loopRampPoints(ring, fromZ, zMm, rampMm);
}

// Descend along the loop INTO its start, lapping as often as that takes, then
// cut one whole lap at depth from the start, so the pass ends on its start.
// Built backwards from the start, so the start sits exactly at depth.
function loopRampIntoStart(
  ring: ReadonlyArray<Vec2>,
  fromZ: number,
  zMm: number,
  rampMm: number,
): Vec3[] {
  const last = ring.length - 1; // ring[last] repeats ring[0]
  const descent: Vec3[] = [at(ring[last] as Vec2, zMm)];
  let back = 0;
  for (let index = last; ; index = index === 1 ? last : index - 1) {
    const nearer = ring[index] as Vec2;
    const farther = ring[index - 1] as Vec2;
    const segment = Math.hypot(nearer.x - farther.x, nearer.y - farther.y);
    if (segment === 0) continue;
    const remaining = rampMm - back;
    if (segment >= remaining) {
      descent.push(at(along(nearer, farther, remaining / segment), fromZ));
      break;
    }
    back += segment;
    descent.push(at(farther, zMm + (back / rampMm) * (fromZ - zMm)));
  }
  descent.reverse();
  return [...descent, ...ring.slice(1).map((point) => at(point, zMm))];
}

// Zig-zag along the path's first span, forward and back an even number of
// times so the descent lands on the start at depth, then the whole path. The
// legs share the ramp's length equally, so each descends at the full angle.
function zigZagRampPoints(
  path: ReadonlyArray<Vec2>,
  fromZ: number,
  zMm: number,
  rampMm: number,
  lengthMm: number,
): Vec3[] {
  const legs = 2 * Math.max(1, Math.ceil(rampMm / (2 * lengthMm) - COUNT_EPSILON));
  const forward = leadingSpan(path, rampMm / legs);
  const back = [...forward].reverse();
  const start = path[0] as Vec2;
  const points: Vec3[] = [at(start, fromZ)];
  let travelled = 0;
  for (let leg = 0; leg < legs; leg += 1) {
    const walk = leg % 2 === 0 ? forward : back;
    for (let k = 1; k < walk.length; k += 1) {
      const a = walk[k - 1] as Vec2;
      const b = walk[k] as Vec2;
      travelled += Math.hypot(b.x - a.x, b.y - a.y);
      points.push(at(b, fromZ - Math.min(1, travelled / rampMm) * (fromZ - zMm)));
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

export type RampEntryPlunges = {
  readonly layerId: string;
  readonly passes: number;
  readonly pocket: boolean;
};

/** Per layer, the passes its ramp entry left to plunge (ADR-471). */
export function rampEntryPlungesByLayer(job: Job): ReadonlyArray<RampEntryPlunges> {
  const byLayer = new Map<string, RampEntryPlunges>();
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    const passes = rampEntryPlungeCount(group.passes);
    if (passes === 0) continue;
    const seen = byLayer.get(group.layerId);
    byLayer.set(group.layerId, {
      layerId: group.layerId,
      passes: (seen?.passes ?? 0) + passes,
      pocket: (seen?.pocket ?? false) || group.cutType === 'pocket',
    });
  }
  return [...byLayer.values()];
}

/** Passes a ramp entry left to plunge because their paths are too short. */
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

function along(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function at(point: Vec2, z: number): Vec3 {
  return { x: point.x, y: point.y, z };
}
