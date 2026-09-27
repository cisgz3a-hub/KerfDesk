import type { Vec3 } from '../geometry/vec3';
import type { CncPath3dPass } from '../job';
import {
  descentBudget,
  descentSteps,
  emittedDescentSteps,
  type DescentBudget,
  type StepCapacity,
} from './ramp-descent-budget';

/**
 * Compose an entry with a rectangular-tab ring, keeping its original Z
 * walls. Only lower spans advance the descent: a tab at the entry seam must
 * not consume the ramp and turn the first entry into a vertical wall plunge.
 * Once at depth, walk one complete original ring from that exact point, so
 * the ramp leaves neither a sloping floor nor a cut-through bridge. The
 * descent is planned and fed as the contour ramp's is (ADR-472).
 */
export function rampTabbedPath(pass: CncPath3dPass, fromZ: number, tangent: number): CncPath3dPass {
  const source = pass.points;
  const first = source[0];
  const last = source.at(-1);
  if (first === undefined || last === undefined || !samePoint(first, last)) return pass;
  const depth = source.reduce((min, point) => Math.min(min, point.z), Infinity);
  if (!(fromZ > depth) || !(tangent > 0)) return pass;
  const lowSpans = lowSpanCapacity(source, depth, tangent);
  if (!(lowSpans.lengthMm > 0) || emittedDescentSteps(fromZ, depth) < 1) return pass;

  const budget = descentBudget(lowSpans, fromZ, depth, tangent);
  const fullLaps = Math.max(0, Math.ceil(budget.total / lapDescent(source, depth, budget)) - 1);
  const minimumPointCount = fullLaps * (source.length - 1) + source.length + 1;
  if (minimumPointCount > 0xffff_ffff) {
    throw new RangeError('Tabbed ramp point count exceeds the ECMAScript Array length limit.');
  }
  return {
    ...pass,
    points: rampedPoints(source, fromZ, depth, budget, fullLaps),
    closed: false,
    lateralFeed: 'z-rate-capped',
    ...(budget.stepped ? {} : { entryAngleApproximate: true as const }),
  };
}

// The length of the low spans, and the whole 0.001 mm steps they can carry.
function lowSpanCapacity(
  source: ReadonlyArray<Vec3>,
  depth: number,
  tangent: number,
): StepCapacity {
  let steps = 0;
  let lengthMm = 0;
  for (let index = 1; index < source.length; index += 1) {
    const a = source[index - 1] as Vec3;
    const b = source[index] as Vec3;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    // This helper owns rectangular tabs, not arbitrary variable-depth paths.
    if (length > 0 && a.z !== b.z) return { steps: 0, lengthMm: 0 };
    if (b.z !== depth) continue;
    steps += descentSteps(a, b, tangent);
    lengthMm += length;
  }
  return { steps, lengthMm };
}

// The descent one lap of the low spans can carry under the budget.
function lapDescent(source: ReadonlyArray<Vec3>, depth: number, budget: DescentBudget): number {
  let descent = 0;
  for (let index = 1; index < source.length; index += 1) {
    const b = source[index] as Vec3;
    if (b.z === depth) descent += budget.carries(source[index - 1] as Vec3, b);
  }
  return descent;
}

function rampedPoints(
  source: ReadonlyArray<Vec3>,
  fromZ: number,
  depth: number,
  budget: DescentBudget,
  fullLaps: number,
): ReadonlyArray<Vec3> {
  const first = source[0] as Vec3;
  const points: Vec3[] = [{ ...first, z: Math.max(first.z, fromZ) }];
  let rampZ = fromZ;
  let descended = 0;
  // A small closed ring may require more than one lap. Each lap progresses
  // by a known positive amount; no vertical shortcut cuts into a tab.
  for (let lap = 0; lap <= fullLaps; lap += 1) {
    for (let index = 1; index < source.length; index += 1) {
      const a = source[index - 1] as Vec3;
      const b = source[index] as Vec3;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length > 0 && b.z === depth) {
        const carried = budget.carries(a, b);
        if (descended + carried >= budget.total) {
          const end = { ...budget.endFor(a, b, budget.total - descended), z: depth };
          points.push(end);
          for (const point of source.slice(index)) points.push(point);
          for (const point of source.slice(1, index)) points.push(point);
          points.push(end);
          return points;
        }
        descended += carried;
        rampZ = budget.zAfter(descended);
      }
      points.push({ ...b, z: Math.max(b.z, rampZ) });
    }
  }
  throw new RangeError('Tabbed ramp descent cannot be represented at coordinate precision.');
}

function samePoint(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
