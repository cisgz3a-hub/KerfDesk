import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LaserSecondPassSelection } from '../../core/laser-second-pass';
import type { FramedRunCandidate, FramedRunPermit } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import type { RecoveryRepository } from '../state/recovery';
import {
  laserSecondPassExecutionSignature,
  type LaserSecondPassStage,
} from '../state/recovery/laser-second-pass-lineage';
import type { FramedRunStartClaim } from './framed-run-start-claim';
import { currentLaserForAuthorizedStartNow } from './start-job-authorization';

const SELECTION: LaserSecondPassSelection = {
  version: 1,
  maxPowerS: 1000,
  strokes: [{ id: 'one', mode: 'paint', radiusMm: 2, powerScale: 1.2, points: [{ x: 5, y: 5 }] }],
};

function stage(selection: LaserSecondPassSelection): LaserSecondPassStage {
  return {
    sourceRunId: 'run-source',
    sourceFingerprint: { fnv1a: 1, chars: 10, lines: 2 },
    resumeChainBefore: [],
    selection,
  };
}

/** Only the fields the synchronous gate reads; the permit itself is the claim's
 * identity, exactly as the store installs it after a completed Frame. */
function secondPassClaim(executionSignature: string, chainStage: LaserSecondPassStage) {
  const candidate = {
    authorizationContext: 'laser-second-pass',
    executionSignature,
    preparedStart: { laserSecondPassChain: [chainStage] },
  } as unknown as FramedRunCandidate;
  const permit = { candidate } as unknown as FramedRunPermit;
  const claim: FramedRunStartClaim = { permit };
  useLaserStore.setState({ framedRun: permit, framedRunStartClaim: claim });
  return claim;
}

function authorize(claim: FramedRunStartClaim) {
  return currentLaserForAuthorizedStartNow({
    preparedAgainst: useLaserStore.getState(),
    checkpointToReplace: null,
    completedReceipt: null,
    expectedExecutionSignature: claim.permit.candidate.executionSignature,
    repository: {} as unknown as RecoveryRepository,
    framedRunClaim: claim,
  });
}

beforeEach(() => {
  useLaserStore.setState(initialLaserState());
});

afterEach(() => {
  useLaserStore.setState(initialLaserState());
});

describe('second-pass Start authorization binds the permit to its sealed lineage', () => {
  it('accepts a permit whose signature names the source run and exact selection', () => {
    const claim = secondPassClaim(
      laserSecondPassExecutionSignature('run-source', SELECTION),
      stage(SELECTION),
    );
    expect(authorize(claim).ok).toBe(true);
  });

  it('refuses a permit whose signature no longer matches the sealed selection', () => {
    const edited: LaserSecondPassSelection = {
      ...SELECTION,
      strokes: [{ ...SELECTION.strokes[0]!, powerScale: 1.9 }],
    };
    const claim = secondPassClaim(
      laserSecondPassExecutionSignature('run-source', edited),
      stage(SELECTION),
    );
    const result = authorize(claim);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toEqual({ kind: 'execution-inputs-changed' });
  });

  it('refuses a permit that names another source run or carries no lineage', () => {
    const otherRun = secondPassClaim(
      laserSecondPassExecutionSignature('run-other', SELECTION),
      stage(SELECTION),
    );
    expect(authorize(otherRun).ok).toBe(false);
    const candidate = {
      authorizationContext: 'laser-second-pass',
      executionSignature: laserSecondPassExecutionSignature('run-source', SELECTION),
      preparedStart: {},
    } as unknown as FramedRunCandidate;
    const permit = { candidate } as unknown as FramedRunPermit;
    const claim: FramedRunStartClaim = { permit };
    useLaserStore.setState({ framedRun: permit, framedRunStartClaim: claim });
    const result = authorize(claim);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toEqual({ kind: 'execution-inputs-changed' });
  });
});
