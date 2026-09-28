import type { Vec3 } from '../geometry/vec3';
import type { CncPath3dPass } from '../job';
import {
  assertRampPointCount,
  rampCapacities,
  rampDepth,
  rampSegmentEnd,
  rampZ,
  type RampDepth,
} from './contour-ramp-precision';

/**
 * Compose an entry with a rectangular-tab ring, keeping its original Z
 * walls. Only lower spans advance the descent: a tab at the entry seam must
 * not consume the ramp and turn the first entry into a vertical wall plunge.
 * Once at depth, walk one complete original ring from that exact point, so
 * the ramp leaves neither a sloping floor nor a cut-through bridge.
 */
export function rampTabbedPath(pass: CncPath3dPass, fromZ: number, tangent: number): CncPath3dPass {
  const source = pass.points;
  if (!isClosedRing(source)) return pass;
  const depth = source.reduce((min, point) => Math.min(min, point.z), Infinity);
  if (!(fromZ > depth) || !(tangent > 0)) return pass;
  const availableLength = lowSpanLength(source, depth);
  if (!(availableLength > 0)) return pass;

  const descent = rampDepth(fromZ, depth);
  if (descent !== null && descent.dropQuanta <= 0) return pass;
  const capacities = rampCapacities(source, tangent, descent?.dropQuanta ?? 0).map(
    (capacity, index) => (source[index + 1]?.z === depth ? capacity : 0),
  );
  const capacity = capacities.reduce((sum, value) => sum + value, 0);
  if (descent === null || !(capacity > 0)) {
    return { ...pass, entryPlunge: true, entryPlungeReason: 'coordinate-precision' };
  }
  const laps = Math.ceil(descent.dropQuanta / capacity);
  assertRampPointCount(laps * (source.length - 1) + source.length + 1);
  return {
    ...pass,
    points: rampedPoints(source, descent, capacities, tangent, laps),
    closed: false,
    // Only low horizontal source spans earn ramp descent. Later vertical tab
    // walls remain intentional tab geometry, not a maximum-angle promise.
    entryRamp: true,
    lateralFeed: 'z-rate-capped',
  };
}

function lowSpanLength(source: ReadonlyArray<Vec3>, depth: number): number {
  let availableLength = 0;
  for (let index = 1; index < source.length; index += 1) {
    const a = source[index - 1] as Vec3;
    const b = source[index] as Vec3;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    // This helper owns rectangular tabs, not arbitrary variable-depth paths.
    if (length > 0 && a.z !== b.z) return 0;
    if (b.z === depth) availableLength += length;
  }
  return availableLength;
}

function rampedPoints(
  source: ReadonlyArray<Vec3>,
  descent: RampDepth,
  capacities: ReadonlyArray<number>,
  tangent: number,
  laps: number,
): ReadonlyArray<Vec3> {
  const first = source[0] as Vec3;
  const fromZ = rampZ(descent.fromQuanta);
  const depth = rampZ(descent.targetQuanta);
  const points: Vec3[] = [{ ...first, z: Math.max(first.z, fromZ) }];
  let currentRampZ = fromZ;
  let remaining = descent.dropQuanta;
  // A small closed ring may require more than one lap. Each lap progresses
  // by a known positive amount; no vertical shortcut cuts into a tab.
  for (let lap = 0; lap < laps; lap += 1) {
    for (let index = 1; index < source.length; index += 1) {
      const a = source[index - 1] as Vec3;
      const b = source[index] as Vec3;
      const step = capacities[index - 1] ?? 0;
      if (step > 0) {
        if (remaining <= step) {
          const end = { ...rampSegmentEnd(a, b, tangent, remaining), z: depth };
          points.push(end);
          for (const point of source.slice(index)) points.push(point);
          for (const point of source.slice(1, index)) points.push(point);
          points.push(end);
          return points;
        }
        remaining -= step;
        currentRampZ = rampZ(descent.targetQuanta + remaining);
      }
      points.push({ ...b, z: Math.max(b.z, currentRampZ) });
    }
  }
  throw new RangeError('Tabbed ramp descent cannot be represented at coordinate precision.');
}

function samePoint(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function isClosedRing(points: ReadonlyArray<Vec3>): boolean {
  const first = points[0];
  const last = points.at(-1);
  return first !== undefined && last !== undefined && samePoint(first, last);
}
