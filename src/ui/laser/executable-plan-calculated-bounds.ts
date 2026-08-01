import type { ExecutablePlanV1 } from '../../core/execution-plan';
import { formatGcodeCoordinateMm } from '../../core/gcode';
import type { JobBounds, JobOriginPlacement } from '../../core/job';

export type ExecutablePlanCalculatedBoundsSelection =
  | {
      readonly source: 'executable-plan';
      readonly jobBounds: JobBounds | null;
      readonly motionBounds: JobBounds | null;
    }
  | {
      readonly source: 'legacy-job';
      readonly reason:
        | 'plan-unavailable'
        | 'current-position-basis'
        | 'rotary-surface-space'
        | 'bounds-mismatch';
      readonly jobBounds: JobBounds | null;
      readonly motionBounds: JobBounds | null;
    };

/**
 * Promotes the exact emitted plan to calculated-bounds authority only when its
 * two public XY bounds agree atomically with the existing Job calculations at
 * the coordinate precision written to G-code. A disagreement retains both
 * legacy values; mixing one authority's job bounds with the other's motion
 * bounds would create a representation that neither path actually produced.
 */
export function selectExecutablePlanCalculatedBounds(args: {
  readonly legacyJobBounds: JobBounds | null;
  readonly legacyMotionBounds: JobBounds | null;
  readonly executablePlan?: ExecutablePlanV1;
  readonly jobOrigin?: JobOriginPlacement;
  readonly rotaryApplies: boolean;
}): ExecutablePlanCalculatedBoundsSelection {
  const legacy = {
    source: 'legacy-job' as const,
    jobBounds: args.legacyJobBounds,
    motionBounds: args.legacyMotionBounds,
  };
  if (args.executablePlan === undefined) {
    return { ...legacy, reason: 'plan-unavailable' };
  }
  // v1 records an assumed work-origin start basis. A Current Position job has
  // a runtime start identity even when its numeric XY happens to be 0,0.
  if (args.jobOrigin?.startFrom === 'current-position') {
    return { ...legacy, reason: 'current-position-basis' };
  }
  // Prepared job bounds remain design-surface coordinates for rotary work,
  // while the emitted plan is machine-space after the rotary scale is applied.
  if (args.rotaryApplies) {
    return { ...legacy, reason: 'rotary-surface-space' };
  }

  const planJobBounds = xyBounds(args.executablePlan.bounds.processMm);
  const planMotionBounds = xyBounds(args.executablePlan.bounds.allMotionMm);
  if (
    !finiteBounds(args.legacyJobBounds) ||
    !finiteBounds(args.legacyMotionBounds) ||
    !finiteBounds(planJobBounds) ||
    !finiteBounds(planMotionBounds) ||
    !sameBoundsAtEmitPrecision(args.legacyJobBounds, planJobBounds) ||
    !sameBoundsAtEmitPrecision(args.legacyMotionBounds, planMotionBounds)
  ) {
    return { ...legacy, reason: 'bounds-mismatch' };
  }
  return {
    source: 'executable-plan',
    jobBounds: planJobBounds,
    motionBounds: planMotionBounds,
  };
}

function xyBounds(bounds: ExecutablePlanV1['bounds']['processMm']): JobBounds | null {
  if (bounds === null) return null;
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  };
}

function finiteBounds(bounds: JobBounds | null): boolean {
  return (
    bounds === null || [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
  );
}

function sameBoundsAtEmitPrecision(left: JobBounds | null, right: JobBounds | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    sameCoordinate(left.minX, right.minX) &&
    sameCoordinate(left.minY, right.minY) &&
    sameCoordinate(left.maxX, right.maxX) &&
    sameCoordinate(left.maxY, right.maxY)
  );
}

function sameCoordinate(left: number, right: number): boolean {
  return formatGcodeCoordinateMm(left) === formatGcodeCoordinateMm(right);
}
