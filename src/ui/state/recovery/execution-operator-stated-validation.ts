// Archive checks for a laser Start that rested on the operator's recorded
// power-scale statement (ADR-095 Amendment 1). The archive says
// `laser-operator-stated`, shows the fact line the operator saw, and keeps the
// statement itself beside the Start evidence. It is never stored as verified.

import { isOperatorPowerScaleStatement } from '../../../core/devices/power-scale-statement';
import { isBoundedString, isRecord } from './execution-provenance-validation-helpers';

export const OPERATOR_STATED_ACKNOWLEDGEMENT_KIND = 'laser-operator-stated';

/** The acknowledgement an operator-stated review archives: its kind and the
 * fact line Job Review showed. */
export function isOperatorStatedAcknowledgement(value: Record<string, unknown>): boolean {
  return (
    value['kind'] === OPERATOR_STATED_ACKNOWLEDGEMENT_KIND && isBoundedString(value['statement'], 1)
  );
}

/** The optional statement on archived Start evidence is absent or well formed. */
export function hasValidOptionalOperatorStatement(evidence: Record<string, unknown>): boolean {
  const statement = evidence['operatorStatedPowerScale'];
  return statement === undefined || isOperatorPowerScaleStatement(statement);
}

/** An operator-stated acknowledgement and a statement on the evidence come
 * together or not at all, and the statement must cover the Start: the same
 * Full-power S, on a firmware with no settings report, with nothing clicked. */
export function operatorStatementMatchesReview(
  acknowledgement: Record<string, unknown>,
  review: Record<string, unknown>,
): boolean {
  const evidence = review['laserModeStartEvidence'];
  const statement = isRecord(evidence) ? evidence['operatorStatedPowerScale'] : undefined;
  const stated = acknowledgement['kind'] === OPERATOR_STATED_ACKNOWLEDGEMENT_KIND;
  if (!stated) return statement === undefined;
  return (
    isRecord(evidence) &&
    isOperatorPowerScaleStatement(statement) &&
    evidence['settingsCapability'] === 'none' &&
    evidence['unverifiedAcknowledged'] === false &&
    statement.maxPowerS === evidence['expectedMaxPowerS']
  );
}
