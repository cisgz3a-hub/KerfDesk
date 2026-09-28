import type { Vec2 } from '../scene';
import { CNC_COORDINATE_QUANTUM_MM, formatCncCoordinateMm } from './cnc-output-precision';

const QUANTUM = CNC_COORDINATE_QUANTUM_MM;
const MAX_ARRAY_LENGTH = 0xffff_ffff;

export type RampDepth = {
  readonly fromQuanta: number;
  readonly targetQuanta: number;
  readonly dropQuanta: number;
};

/** Z budgets use the same coordinate words as the ordinary CNC emitter. */
export function rampDepth(fromZ: number, targetZ: number): RampDepth | null {
  const fromQuanta = Math.round(Number(formatCncCoordinateMm(fromZ)) / QUANTUM);
  const targetQuanta = Math.round(Number(formatCncCoordinateMm(targetZ)) / QUANTUM);
  const dropQuanta = fromQuanta - targetQuanta;
  return [fromQuanta, targetQuanta, dropQuanta].every(Number.isSafeInteger)
    ? { fromQuanta, targetQuanta, dropQuanta }
    : null;
}

export function rampZ(quanta: number): number {
  return Number(formatCncCoordinateMm(quanta * QUANTUM));
}

/**
 * A later shared XY origin translation may round the two endpoints in opposite
 * directions. Reserve a full output quantum per component before assigning any
 * Z quantum. Source vertices stay unchanged; zero-capacity spans remain level.
 */
export function rampSegmentCapacity(a: Vec2, b: Vec2, tangent: number, maximum: number): number {
  const dx = Math.max(0, Math.abs(b.x - a.x) - QUANTUM);
  const dy = Math.max(0, Math.abs(b.y - a.y) - QUANTUM);
  return Math.min(maximum, Math.floor((Math.hypot(dx, dy) * tangent) / QUANTUM));
}

export function rampCapacities(
  path: ReadonlyArray<Vec2>,
  tangent: number,
  maximum: number,
): ReadonlyArray<number> {
  return path
    .slice(1)
    .map((point, index) => rampSegmentCapacity(path[index] as Vec2, point, tangent, maximum));
}

/** The earliest point on this exact segment that can express the requested drop. */
export function rampSegmentEnd(a: Vec2, b: Vec2, tangent: number, quanta: number): Vec2 {
  return along(a, b, rampSegmentEndFraction(a, b, tangent, quanta));
}

/** Budget placed XY while allowing a caller to interpolate its matching source span. */
export function rampSegmentEndFraction(a: Vec2, b: Vec2, tangent: number, quanta: number): number {
  let lower = 0;
  let upper = 1;
  // Bisection only inserts a point on an existing straight span. The upper
  // endpoint always has enough capacity, including its own binary rounding.
  for (let iteration = 0; iteration < 53; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (rampSegmentCapacity(a, along(a, b, middle), tangent, quanta) < quanta) lower = middle;
    else upper = middle;
  }
  return upper;
}

/** Spread a leg's integer descent without ever exceeding one segment's budget. */
export function rampDescentSteps(capacities: ReadonlyArray<number>, drop: number): number[] {
  const suffix = new Array<number>(capacities.length + 1).fill(0);
  for (let index = capacities.length - 1; index >= 0; index -= 1) {
    suffix[index] = Math.min(drop, (capacities[index] ?? 0) + (suffix[index + 1] ?? 0));
  }
  const total = capacities.reduce((sum, capacity) => sum + capacity, 0);
  let capacitySoFar = 0;
  let assigned = 0;
  return capacities.map((capacity, index) => {
    capacitySoFar += capacity;
    const ideal = Math.round(drop * (capacitySoFar / total)) - assigned;
    const required = drop - assigned - (suffix[index + 1] ?? 0);
    const step = Math.min(capacity, drop - assigned, Math.max(0, ideal, required));
    assigned += step;
    return step;
  });
}

export function assertRampPointCount(count: number): void {
  if (!Number.isSafeInteger(count) || count > MAX_ARRAY_LENGTH) {
    throw new RangeError('Contour ramp point count exceeds the ECMAScript Array length limit.');
  }
}

function along(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
