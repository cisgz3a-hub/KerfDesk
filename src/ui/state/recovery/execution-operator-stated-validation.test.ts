// What an archive may say about an operator-stated power scale (ADR-095
// Amendment 1). The Start-flow test (run-again-review-carry.operator-stated)
// proves a real archive passes the whole validator; these are the shapes
// KerfDesk never writes.
import { describe, expect, it } from 'vitest';
import {
  hasValidOptionalOperatorStatement,
  isOperatorStatedAcknowledgement,
  operatorStatementMatchesReview,
} from './execution-operator-stated-validation';
import { hasValidCarriedOver } from './execution-review-carried-over-validation';

const statement = {
  maxPowerS: 255,
  controllerKind: 'marlin',
  dialectId: 'marlin-inline',
  statedAtIso: '2026-11-11T10:00:00.000Z',
};
const evidence = {
  settingsCapability: 'none',
  expectedMaxPowerS: 255,
  unverifiedAcknowledged: false,
  operatorStatedPowerScale: statement,
};
const stated = { kind: 'laser-operator-stated', statement: 'Power scale: operator-stated. …' };

describe('an operator-stated acknowledgement', () => {
  it('needs the fact line the operator saw', () => {
    expect(isOperatorStatedAcknowledgement(stated)).toBe(true);
    expect(isOperatorStatedAcknowledgement({ kind: 'laser-operator-stated' })).toBe(false);
    expect(isOperatorStatedAcknowledgement({ ...stated, statement: '' })).toBe(false);
    expect(isOperatorStatedAcknowledgement({ ...stated, kind: 'laser-verified' })).toBe(false);
  });

  it('matches only evidence its statement covers', () => {
    const review = { laserModeStartEvidence: evidence };
    expect(operatorStatementMatchesReview(stated, review)).toBe(true);
    for (const broken of [
      { ...evidence, operatorStatedPowerScale: undefined },
      { ...evidence, settingsCapability: 'grbl-dollar' },
      { ...evidence, expectedMaxPowerS: 100 },
      { ...evidence, unverifiedAcknowledged: true },
      { ...evidence, operatorStatedPowerScale: { ...statement, controllerKind: 'grbl-v1.1' } },
    ]) {
      expect(operatorStatementMatchesReview(stated, { laserModeStartEvidence: broken })).toBe(
        false,
      );
    }
    expect(operatorStatementMatchesReview(stated, {})).toBe(false);
  });

  it('is the only kind a statement may sit beside: it is never archived as verified', () => {
    const review = { laserModeStartEvidence: evidence };
    expect(operatorStatementMatchesReview({ kind: 'laser-verified' }, review)).toBe(false);
    expect(operatorStatementMatchesReview({ kind: 'laser-unverified', prompt: 'p' }, review)).toBe(
      false,
    );
    const plain = { laserModeStartEvidence: { ...evidence, operatorStatedPowerScale: undefined } };
    expect(operatorStatementMatchesReview({ kind: 'laser-verified' }, plain)).toBe(true);
  });

  it('rejects a malformed statement on the evidence', () => {
    expect(hasValidOptionalOperatorStatement(evidence)).toBe(true);
    expect(hasValidOptionalOperatorStatement({})).toBe(true);
    expect(hasValidOptionalOperatorStatement({ operatorStatedPowerScale: true })).toBe(false);
    expect(
      hasValidOptionalOperatorStatement({
        operatorStatedPowerScale: { ...statement, maxPowerS: -1 },
      }),
    ).toBe(false);
  });
});

describe('a carried review (ADR-237 Amendment 4)', () => {
  const workflow = { kind: 'ordinary-start', completedReplaySourceRunId: 'run-a' } as never;
  const carriedOver = {
    fromRunId: 'run-a',
    operatorReviewedRunId: 'run-a',
    operatorReviewedAtIso: '2026-11-11T10:00:00.000Z',
  };

  it.each(['laser-verified', 'laser-operator-stated'])('may rest on %s', (kind) => {
    expect(hasValidCarriedOver({ carriedOver, acknowledgement: { kind } }, workflow)).toBe(true);
  });

  it.each(['laser-unverified', 'cnc'])('may not rest on %s', (kind) => {
    expect(hasValidCarriedOver({ carriedOver, acknowledgement: { kind } }, workflow)).toBe(false);
  });
});
