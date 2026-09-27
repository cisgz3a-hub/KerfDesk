import type { Vec2 } from '../scene';
import { CNC_COORDINATE_QUANTUM_MM, formatCncCoordinateMm } from './cnc-output-precision';

// How far a contour or tabbed ramp descends along each move, and the Z it
// writes (ADR-472).
//
// The emitter writes 0.001 mm coordinates, so a ramp planned in floating point
// comes out steeper than its angle on short moves: 5.4 degrees under a 5 degree
// header round a 6 mm hole, and 63 degrees under 45 where a ramp ended a
// micrometre past a vertex. Planned in whole 0.001 mm steps against the
// shortest each move can be once rounded (ADR-278's budget), no emitted move
// is steeper than the angle, wherever job-origin placement moves the job.
//
// Each move loses up to one step to that budget, so on a path made of moves
// too short to carry whole steps the ramp would grow long, or could not
// descend at all. Where the steps would more than double it, the ramp keeps
// the angle as planned before rounding, and the G-code says so.

const QUANTUM_MM = CNC_COORDINATE_QUANTUM_MM;
// Bisection steps: far below one 0.001 mm step on any bed-sized path.
const SEARCH_STEPS = 48;
// The most a step budget may lengthen the ramp the angle asks for.
const MAX_STEP_STRETCH = 2;

export type DescentBudget = {
  /** Planned in whole 0.001 mm steps, so the angle holds once emitted. */
  readonly stepped: boolean;
  /** The descent to plan: whole steps, or millimetres when not stepped. */
  readonly total: number;
  /** The descent the move a→b can carry. */
  readonly carries: (a: Vec2, b: Vec2) => number;
  /** The earliest point along a→b whose move from `a` carries `descent`. */
  readonly endFor: (a: Vec2, b: Vec2, descent: number) => Vec2;
  /** The Z written once `descent` of the total is descended. */
  readonly zAfter: (descent: number) => number;
  /** The part of the total due once `carried` of `capacity` is walked. */
  readonly shareAfter: (carried: number, capacity: number) => number;
};

/** What a path's moves can carry in whole steps, against their length. */
export type StepCapacity = { readonly steps: number; readonly lengthMm: number };

/**
 * The whole 0.001 mm steps the move from `a` to `b` can descend and stay within
 * `tangent` once emitted. Rounding both ends to 0.001 mm, before or after a
 * job-origin shift, shortens each axis by at most one step.
 */
export function descentSteps(a: Vec2, b: Vec2, tangent: number): number {
  const dx = Math.max(0, Math.abs(b.x - a.x) - QUANTUM_MM);
  const dy = Math.max(0, Math.abs(b.y - a.y) - QUANTUM_MM);
  return Math.floor((Math.hypot(dx, dy) * tangent) / QUANTUM_MM + 1e-12);
}

/** The whole 0.001 mm steps between two depths as the emitter writes them. */
export function emittedDescentSteps(fromZ: number, zMm: number): number {
  return zSteps(fromZ) - zSteps(zMm);
}

/**
 * The budget for a ramp from `fromZ` to `zMm` over moves with `capacity`:
 * whole 0.001 mm steps, unless they would more than double the ramp.
 */
export function descentBudget(
  capacity: StepCapacity,
  fromZ: number,
  zMm: number,
  tangent: number,
): DescentBudget {
  const angleSteps = (capacity.lengthMm * tangent) / QUANTUM_MM;
  return capacity.steps * MAX_STEP_STRETCH >= angleSteps
    ? stepBudget(fromZ, zMm, tangent)
    : angleBudget(fromZ, zMm, tangent);
}

function stepBudget(fromZ: number, zMm: number, tangent: number): DescentBudget {
  const top = zSteps(fromZ);
  const total = top - zSteps(zMm);
  return {
    stepped: true,
    total,
    carries: (a, b) => descentSteps(a, b, tangent),
    endFor: (a, b, steps) => stepEnd(a, b, steps, tangent),
    zAfter: (steps) => zAtSteps(top - steps),
    shareAfter: (carried, capacity) => Math.floor((total * carried) / capacity),
  };
}

// The ramp as planned before rounding: exactly `tangent` down per mm.
function angleBudget(fromZ: number, zMm: number, tangent: number): DescentBudget {
  const total = fromZ - zMm;
  const carries = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y) * tangent;
  return {
    stepped: false,
    total,
    carries,
    endFor: (a, b, descent) => along(a, b, descent / carries(a, b)),
    zAfter: (descent) => fromZ - descent,
    shareAfter: (carried, capacity) => (total * carried) / capacity,
  };
}

// The earliest point along a→b whose move from `a` can carry `steps`.
function stepEnd(a: Vec2, b: Vec2, steps: number, tangent: number): Vec2 {
  let low = 0;
  let high = 1;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (descentSteps(a, along(a, b, middle), tangent) >= steps) high = middle;
    else low = middle;
  }
  return high === 1 ? b : along(a, b, high);
}

/**
 * The shortest length in (0, lengthMm] that `fits`, given that it fits at
 * `lengthMm` and keeps fitting as the length grows.
 */
export function shortestFittingLength(
  lengthMm: number,
  fits: (lengthMm: number) => boolean,
): number {
  let low = 0;
  let high = lengthMm;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) high = middle;
    else low = middle;
  }
  return high;
}

export function along(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Z as the whole number of 0.001 mm steps the emitter writes for it.
function zSteps(z: number): number {
  return Math.round(Number(formatCncCoordinateMm(z)) / QUANTUM_MM);
}

function zAtSteps(steps: number): number {
  return Number(formatCncCoordinateMm(steps * QUANTUM_MM));
}
