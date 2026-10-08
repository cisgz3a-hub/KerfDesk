import type { ReliefAuthoringDocument } from '../scene/relief/relief-authoring';
import type { ReliefHeightfield } from '../scene/relief/relief-heightfield';

const compositionProofs = new WeakMap<ReliefHeightfield, ReliefAuthoringDocument>();

/** Private in-process capability recorded only after an owned worker resolves. */
export function recordOwnedReliefComposition(
  document: ReliefAuthoringDocument,
  field: ReliefHeightfield,
): void {
  compositionProofs.set(field, document);
}
export function isOwnedReliefComposition(
  document: ReliefAuthoringDocument,
  field: ReliefHeightfield,
): boolean {
  return compositionProofs.get(field) === document;
}
