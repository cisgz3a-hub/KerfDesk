import type { ExecutablePlanV1 } from './executable-plan-types';

/** Serializes v1 losslessly through its exact legacy compatibility carrier. See ADR-271. */
export function serializeExecutablePlan(plan: ExecutablePlanV1): string {
  return plan.compatibility.exactProgram;
}
