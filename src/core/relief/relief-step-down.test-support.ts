// Test helpers for the step-down levels relief finishing cuts first where
// roughing did not reach (ADR-421 Amendment 2).
import type { CncPass, Job } from '../job';

/** The passes other than the step-down levels finishing cuts first where
 * roughing did not reach (ADR-421 Amendment 2). */
export function withoutStepDown(passes: ReadonlyArray<CncPass>): ReadonlyArray<CncPass> {
  return passes.filter((pass) => pass.kind !== 'path3d' || pass.reliefStepDown !== true);
}

/** A job's relief planning evidence, its finishing step-down level count apart. */
export function stepDownEvidence(job: Job): {
  readonly plans: ReadonlyArray<object>;
  readonly levels: number;
} {
  const plans = job.cncCompilation?.reliefPlans ?? [];
  return {
    plans: plans.map(({ finishingStepLevels: _levels, ...plan }) => plan),
    levels: plans.find((plan) => plan.stage === 'finishing')?.finishingStepLevels ?? 0,
  };
}
