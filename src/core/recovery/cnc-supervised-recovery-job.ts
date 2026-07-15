import type { CncContourPass, CncGroup, Job } from '../job';
import {
  planCncContourRunway,
  type CncContourRunwayPlan,
  type CncContourRunwayRequest,
  type CncContourRunwayResult,
  type CncRunwayProfile,
} from './cnc-contour-runway';

export const CNC_SUPERVISED_RECOVERY_MIN_RUNWAY_MM = 5;
export const CNC_SUPERVISED_RECOVERY_MAX_ASSUMED_ACCEL_MM_PER_SEC2 = 100;
export const CNC_SUPERVISED_RECOVERY_SAFETY_MARGIN_MM = 2;

export type CncSupervisedRecoveryJob = {
  readonly kind: 'recovery-job';
  readonly job: Job;
  readonly plan: CncContourRunwayPlan;
};

export type CncSupervisedRecoveryJobResult =
  | CncSupervisedRecoveryJob
  | Exclude<CncContourRunwayResult, CncContourRunwayPlan>
  | { readonly kind: 'error'; readonly reason: 'invalid-source-job' };

export function cncSupervisedRecoveryRunwayProfile(
  configuredAccelerationMmPerSec2: number,
  qualificationId: string,
): CncRunwayProfile {
  const configured =
    Number.isFinite(configuredAccelerationMmPerSec2) && configuredAccelerationMmPerSec2 > 0
      ? configuredAccelerationMmPerSec2
      : Number.NaN;
  return {
    qualificationId: qualificationId.trim(),
    minRunwayMm: CNC_SUPERVISED_RECOVERY_MIN_RUNWAY_MM,
    accelerationMmPerSec2: Math.min(
      configured,
      CNC_SUPERVISED_RECOVERY_MAX_ASSUMED_ACCEL_MM_PER_SEC2,
    ),
    safetyMarginMm: CNC_SUPERVISED_RECOVERY_SAFETY_MARGIN_MM,
  };
}

/**
 * Builds a new, ordinary CNC Job from an explicitly selected uncertainty
 * segment. This function never infers progress from acknowledgements. The
 * first pass re-enters along operator-confirmed clear tangent geometry, then
 * the job keeps all later passes and operations in their original order.
 */
export function buildCncSupervisedRecoveryJob(
  request: CncContourRunwayRequest,
): CncSupervisedRecoveryJobResult {
  const plan = planCncContourRunway(request);
  if (plan.kind !== 'review-plan') return plan;
  const sourceGroup = request.job.groups[plan.source.groupIndex];
  if (sourceGroup?.kind !== 'cnc') return { kind: 'error', reason: 'invalid-source-job' };
  const sourcePass = sourceGroup.passes[plan.source.passIndex];
  if (sourcePass?.kind !== 'contour') return { kind: 'error', reason: 'invalid-source-job' };
  const laterGroups = request.job.groups.slice(plan.source.groupIndex + 1);
  if (laterGroups.some((group) => group.kind !== 'cnc')) {
    return { kind: 'error', reason: 'invalid-source-job' };
  }
  return {
    kind: 'recovery-job',
    plan,
    job: {
      groups: [recoveryGroup(sourceGroup, sourcePass, plan), ...laterGroups],
    },
  };
}

function recoveryGroup(
  sourceGroup: CncGroup,
  sourcePass: CncContourPass,
  plan: CncContourRunwayPlan,
): CncGroup {
  const recoveryPass: CncContourPass = {
    kind: 'contour',
    zMm: sourcePass.zMm,
    closed: false,
    polyline: plan.recoveryPolyline,
  };
  return {
    ...sourceGroup,
    passes: [recoveryPass, ...sourceGroup.passes.slice(plan.source.passIndex + 1)],
  };
}
