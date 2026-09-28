// Circular array placements (ADR-307, LightBurn gap LBG-T14): copies centred
// on a ring, evenly all the way round or over part of it. Angles run
// clockwise on the canvas from the +X axis (scene Y points down).

import type { ArrayPlacement, CircularArraySpec } from './array-layout-types';
import {
  finite,
  finiteNonNegative,
  normalizeDegrees,
  positiveCount,
  unitVectorForDegrees,
} from './array-layout-math';
import type { Bounds } from './scene-object';

export type CircularSweep = {
  readonly count: number;
  /** The first copy's angle, reduced to [0, 360). */
  readonly startDeg: number;
  /** Signed angle from one copy to the next. */
  readonly stepDeg: number;
  /** Signed angle from the first copy to the last. */
  readonly sweepDeg: number;
};

// Within about a millionth of a degree of a whole number of turns.
const WHOLE_TURN_TOLERANCE = 1e-9;

export function circularSweep(spec: CircularArraySpec): CircularSweep {
  const count = positiveCount(spec.count);
  const stepDeg = circularStepDeg(spec, count);
  return {
    count,
    startDeg: normalizeDegrees(finite(spec.startAngleDeg)),
    stepDeg,
    sweepDeg: count > 1 ? stepDeg * (count - 1) : 0,
  };
}

/** True for 360°, 720°, -360°... where an end copy would land on the first one. */
export function isWholeTurns(degrees: number): boolean {
  const turns = Math.abs(degrees) / 360;
  return turns >= 0.5 && Math.abs(turns - Math.round(turns)) <= WHOLE_TURN_TOLERANCE;
}

function circularStepDeg(spec: CircularArraySpec, count: number): number {
  const arc = spec.arc;
  if (arc === undefined) return 360 / count;
  if (arc.kind === 'step') return finite(arc.stepAngleDeg);
  const spanDeg = finite(finite(arc.endAngleDeg) - finite(spec.startAngleDeg));
  // A whole turn leaves the end free: the copy there would double the first.
  if (isWholeTurns(spanDeg)) return spanDeg / count;
  return count > 1 ? spanDeg / (count - 1) : 0;
}

export function circularPlacements(
  bounds: Bounds,
  spec: CircularArraySpec,
): ReadonlyArray<ArrayPlacement> {
  const sweep = circularSweep(spec);
  const radius = finiteNonNegative(spec.radius);
  const sourceCenter = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  // All the way round keeps its original formula, so its placements are unchanged.
  const reducedStep = sweep.stepDeg % 360;
  const angleAt =
    spec.arc === undefined
      ? (index: number) => sweep.startDeg + (index * 360) / sweep.count
      : (index: number) => sweep.startDeg + index * reducedStep;
  return Array.from({ length: sweep.count }, (_, index) => {
    const angleDeg = angleAt(index);
    const unit = unitVectorForDegrees(angleDeg);
    const target = {
      x: finite(spec.centerX) + unit.x * radius,
      y: finite(spec.centerY) + unit.y * radius,
    };
    return {
      dx: target.x - sourceCenter.x,
      dy: target.y - sourceCenter.y,
      rotationDeg: spec.rotateCopies ? angleDeg + 90 : 0,
      ...(spec.rotateCopies ? { pivot: target } : {}),
    };
  });
}
