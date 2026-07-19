import { beforeEach, describe, expect, it } from 'vitest';
import { createFramedRunPermit } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { framedRunCandidate } from '../state/laser-store-motion-operation.test-support';
import {
  claimCurrentFramedRunStart,
  framedRunStartClaimIsCurrent,
  releaseFramedRunStartClaim,
} from './framed-run-start-claim';

beforeEach(() => {
  useLaserStore.setState(initialLaserState());
});

describe('framed-run Start claim ownership', () => {
  it('stores one atomic claim and releases only that exact owner', () => {
    const permit = createFramedRunPermit(framedRunCandidate(), useLaserStore.getState());
    useLaserStore.setState({ framedRun: permit });

    const claim = claimCurrentFramedRunStart(permit);
    expect(claim).not.toBeNull();
    if (claim === null) throw new Error('Expected the first claim to succeed.');
    expect(useLaserStore.getState().framedRunStartClaim).toBe(claim);
    expect(framedRunStartClaimIsCurrent(claim)).toBe(true);
    expect(claimCurrentFramedRunStart(permit)).toBeNull();

    releaseFramedRunStartClaim({ permit });
    expect(useLaserStore.getState().framedRunStartClaim).toBe(claim);
    releaseFramedRunStartClaim(claim);
    expect(useLaserStore.getState().framedRunStartClaim).toBeNull();
  });

  it('rejects a claim after the permit identity changes', () => {
    const permit = createFramedRunPermit(framedRunCandidate(), useLaserStore.getState());
    useLaserStore.setState({ framedRun: null });

    expect(claimCurrentFramedRunStart(permit)).toBeNull();
    expect(useLaserStore.getState().framedRunStartClaim).toBeNull();
  });
});
