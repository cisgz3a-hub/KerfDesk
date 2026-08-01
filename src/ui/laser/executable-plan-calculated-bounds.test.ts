import { describe, expect, it } from 'vitest';
import type { ExecutablePlanV1 } from '../../core/execution-plan';
import type { JobBounds, JobOriginPlacement } from '../../core/job';
import { selectExecutablePlanCalculatedBounds } from './executable-plan-calculated-bounds';

const LEGACY_JOB: JobBounds = { minX: -0.0004, minY: 2, maxX: 10.0004, maxY: 8 };
const LEGACY_MOTION: JobBounds = { minX: -0.0004, minY: 1, maxX: 10.0004, maxY: 9 };
const PLAN_JOB = bounds3d(0, 2, 10, 8);
const PLAN_MOTION = bounds3d(0, 1, 10, 9);

describe('ExecutablePlan calculated-bounds authority', () => {
  it('selects both plan bounds together when both match at emitted coordinate precision', () => {
    const selected = selectExecutablePlanCalculatedBounds({
      legacyJobBounds: LEGACY_JOB,
      legacyMotionBounds: LEGACY_MOTION,
      executablePlan: planWithBounds(PLAN_JOB, PLAN_MOTION),
      rotaryApplies: false,
    });

    expect(selected).toEqual({
      source: 'executable-plan',
      jobBounds: { minX: 0, minY: 2, maxX: 10, maxY: 8 },
      motionBounds: { minX: 0, minY: 1, maxX: 10, maxY: 9 },
    });
  });

  it('rolls both values back when the plan all-motion envelope differs', () => {
    const selected = selectExecutablePlanCalculatedBounds({
      legacyJobBounds: LEGACY_JOB,
      legacyMotionBounds: LEGACY_MOTION,
      executablePlan: planWithBounds(PLAN_JOB, bounds3d(-5, 1, 10, 9)),
      rotaryApplies: false,
    });

    expect(selected).toEqual({
      source: 'legacy-job',
      reason: 'bounds-mismatch',
      jobBounds: LEGACY_JOB,
      motionBounds: LEGACY_MOTION,
    });
  });

  it('retains the runtime Current Position basis even when its numeric position is zero', () => {
    const currentPosition: JobOriginPlacement = {
      startFrom: 'current-position',
      anchor: 'front-left',
      currentPosition: { x: 0, y: 0 },
    };
    const selected = selectExecutablePlanCalculatedBounds({
      legacyJobBounds: LEGACY_JOB,
      legacyMotionBounds: LEGACY_MOTION,
      executablePlan: planWithBounds(PLAN_JOB, PLAN_MOTION),
      jobOrigin: currentPosition,
      rotaryApplies: false,
    });

    expect(selected).toMatchObject({
      source: 'legacy-job',
      reason: 'current-position-basis',
      jobBounds: LEGACY_JOB,
      motionBounds: LEGACY_MOTION,
    });
  });

  it('retains design-surface bounds for rotary jobs', () => {
    const selected = selectExecutablePlanCalculatedBounds({
      legacyJobBounds: LEGACY_JOB,
      legacyMotionBounds: LEGACY_MOTION,
      executablePlan: planWithBounds(PLAN_JOB, PLAN_MOTION),
      rotaryApplies: true,
    });

    expect(selected).toMatchObject({
      source: 'legacy-job',
      reason: 'rotary-surface-space',
      jobBounds: LEGACY_JOB,
      motionBounds: LEGACY_MOTION,
    });
  });

  it('retains both legacy values when no verified plan is available', () => {
    expect(
      selectExecutablePlanCalculatedBounds({
        legacyJobBounds: LEGACY_JOB,
        legacyMotionBounds: LEGACY_MOTION,
        rotaryApplies: false,
      }),
    ).toEqual({
      source: 'legacy-job',
      reason: 'plan-unavailable',
      jobBounds: LEGACY_JOB,
      motionBounds: LEGACY_MOTION,
    });
  });

  it('never promotes non-finite bounds through string-format equality', () => {
    const nonFinite = { ...LEGACY_JOB, maxX: Number.NaN };

    expect(
      selectExecutablePlanCalculatedBounds({
        legacyJobBounds: nonFinite,
        legacyMotionBounds: LEGACY_MOTION,
        executablePlan: planWithBounds(bounds3d(0, 2, Number.NaN, 8), PLAN_MOTION),
        rotaryApplies: false,
      }),
    ).toEqual({
      source: 'legacy-job',
      reason: 'bounds-mismatch',
      jobBounds: nonFinite,
      motionBounds: LEGACY_MOTION,
    });
  });
});

function bounds3d(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): NonNullable<ExecutablePlanV1['bounds']['processMm']> {
  return { minX, minY, minZ: -2, maxX, maxY, maxZ: 3 };
}

function planWithBounds(
  processMm: ExecutablePlanV1['bounds']['processMm'],
  allMotionMm: ExecutablePlanV1['bounds']['allMotionMm'],
): ExecutablePlanV1 {
  return { bounds: { processMm, allMotionMm } } as ExecutablePlanV1;
}
