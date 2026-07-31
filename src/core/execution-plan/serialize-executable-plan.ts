import type { ExecutablePlanV1 } from './executable-plan-types';

/** Lossless v1 compatibility serializer. See ADR-271. */
export function serializeExecutablePlan(plan: ExecutablePlanV1): string {
  return plan.compatibility.exactProgram;
}
