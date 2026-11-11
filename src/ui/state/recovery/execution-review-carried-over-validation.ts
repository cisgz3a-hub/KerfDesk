import { isIsoTimestamp, isRecord, isRunId } from './execution-provenance-validation-helpers';
import type { ExecutionWorkflowV2 } from './execution-workflow-evidence';

/** A carried review (ADR-237 Amendment 3) is recorded only by a laser Run
 * again whose own review needed no acknowledgement, and it names the completed
 * run that workflow repeats. A review resting on the operator's recorded
 * power-scale statement asks nothing either (Amendment 4). Any other shape is
 * not a record KerfDesk writes. */
export function hasValidCarriedOver(
  review: Record<string, unknown>,
  workflow: ExecutionWorkflowV2,
): boolean {
  const carried = review['carriedOver'];
  if (carried === undefined) return true;
  if (!isRecord(carried)) return false;
  if (
    !isRunId(carried['fromRunId']) ||
    !isRunId(carried['operatorReviewedRunId']) ||
    !isIsoTimestamp(carried['operatorReviewedAtIso'])
  ) {
    return false;
  }
  const acknowledgement = review['acknowledgement'];
  return (
    workflow.kind === 'ordinary-start' &&
    workflow.completedReplaySourceRunId === carried['fromRunId'] &&
    isRecord(acknowledgement) &&
    (acknowledgement['kind'] === 'laser-verified' ||
      acknowledgement['kind'] === 'laser-operator-stated')
  );
}
