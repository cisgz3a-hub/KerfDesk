import { describe, expect, it } from 'vitest';
import { isCurrentHomingProof } from './laser-home-proof';

const CURRENT = {
  homingState: 'confirmed' as const,
  controllerSessionEpoch: 4,
  trustedPositionEpoch: 7,
  statusObservation: { sessionEpoch: 4, positionEpoch: 7, sequence: 12, observedAt: 100 },
  homingProof: { sessionEpoch: 4, positionEpoch: 7, confirmedStatusSequence: 12 },
};

describe('isCurrentHomingProof', () => {
  it('accepts proof bound to the current session, position, and fresh status', () => {
    expect(isCurrentHomingProof(CURRENT)).toBe(true);
  });

  it.each([
    { homingState: 'unknown' as const },
    { controllerSessionEpoch: 5 },
    { trustedPositionEpoch: 8 },
    { statusObservation: null },
    { statusObservation: { ...CURRENT.statusObservation, sequence: 11 } },
  ])('rejects stale or incomplete evidence', (patch) => {
    expect(isCurrentHomingProof({ ...CURRENT, ...patch })).toBe(false);
  });
});
