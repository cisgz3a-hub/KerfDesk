import { describe, expect, it } from 'vitest';
import type { ExecutionArtifactV1 } from './execution-artifact';
import {
  emptyRecoverySlots,
  recoveryClaimIsExpired,
  RECOVERY_CLAIM_LEASE_MS,
  type PersistedRecoverySlots,
} from './recovery-model';
import {
  activateClaimedRecoveryMutation,
  activateFreshRunMutation,
  claimRecoveryMutation,
  interruptRunMutation,
  settleLinkLossRestartMutation,
} from './recovery-slot-mutations';

const RUN_ID = 'run-recovery';
const NOW = '2026-07-15T10:00:00.000Z';
// Slot ownership reads only identity and line count; the remaining immutable
// artifact fields are irrelevant to this mutation fixture.
const ARTIFACT = { runId: RUN_ID, sendableLines: 4 } as ExecutionArtifactV1;

const ACTIVE_SLOTS: PersistedRecoverySlots = {
  ...emptyRecoverySlots(0),
  activeRun: {
    runId: RUN_ID,
    ackedLines: 0,
    sendableLines: 4,
    startedAtIso: NOW,
    updatedAtIso: NOW,
  },
};

const INTERRUPTED_SLOTS: PersistedRecoverySlots = {
  ...emptyRecoverySlots(0),
  recoveryCapsule: {
    runId: RUN_ID,
    artifactKind: 'exact-execution',
    revision: 2,
    ackedLines: 1,
    sendableLines: 4,
    interruption: { kind: 'disconnect', message: 'Cable removed.' },
    updatedAtIso: NOW,
  },
};

const COMPLETED_SLOTS: PersistedRecoverySlots = {
  ...emptyRecoverySlots(0),
  lastCompletedReceipt: { runId: RUN_ID, completedAtIso: NOW },
};

describe('activateClaimedRecoveryMutation', () => {
  it.each([
    ['active', ACTIVE_SLOTS],
    ['interrupted', INTERRUPTED_SLOTS],
    ['completed', COMPLETED_SLOTS],
  ] as const)(
    'treats late activation as idempotent after the target run is %s',
    (_state, slots) => {
      const mutation = activateClaimedRecoveryMutation(slots, {
        sourceRunId: 'run-source',
        sourceRevision: 1,
        attemptId: 'attempt-1',
        artifact: ARTIFACT,
        artifactGeneration: 0,
        acceptedAtIso: NOW,
      });

      expect(mutation).toEqual({ slots, value: true });
    },
  );
});

describe('claimRecoveryMutation lease (B4)', () => {
  const CLAIMED_AT = '2026-07-15T10:00:00.000Z';
  const claimedSlots = (claimedAtIso: string): PersistedRecoverySlots => ({
    ...INTERRUPTED_SLOTS,
    recoveryCapsule: {
      ...INTERRUPTED_SLOTS.recoveryCapsule!,
      claim: { attemptId: 'crashed-attempt', claimedAtIso },
    },
  });
  const claimArgs = (claimedAtIso: string) => ({
    runId: RUN_ID,
    revision: 2,
    attemptId: 'fresh-attempt',
    claimedAtIso,
  });

  it('blocks a fresh claim while the existing claim lease is still active', () => {
    const withinLease = new Date(
      Date.parse(CLAIMED_AT) + RECOVERY_CLAIM_LEASE_MS - 1_000,
    ).toISOString();

    const result = claimRecoveryMutation(claimedSlots(CLAIMED_AT), claimArgs(withinLease));

    expect(result.value).toBe(false);
    expect(result.slots.recoveryCapsule?.claim?.attemptId).toBe('crashed-attempt');
  });

  it('lets a fresh claim supersede an existing claim whose lease has expired', () => {
    const pastLease = new Date(
      Date.parse(CLAIMED_AT) + RECOVERY_CLAIM_LEASE_MS + 1_000,
    ).toISOString();

    const result = claimRecoveryMutation(claimedSlots(CLAIMED_AT), claimArgs(pastLease));

    expect(result.value).toBe(true);
    expect(result.slots.recoveryCapsule?.claim?.attemptId).toBe('fresh-attempt');
    expect(result.slots.recoveryCapsule?.claim?.claimedAtIso).toBe(pastLease);
  });
});

describe('repeated interruption of a superseded run', () => {
  const RUN_B = 'run-next';
  const interruption = { kind: 'controller-error', message: 'error:1' } as const;

  it('succeeds without change once a later run replaced the capsule', () => {
    // Run A errored and was recorded; run B then started, clearing A's capsule.
    const recorded = interruptRunMutation(ACTIVE_SLOTS, RUN_ID, 2, interruption, NOW);
    expect(recorded.value).toBe(true);
    const next = activateFreshRunMutation(
      { ...recorded.slots, pendingStart: null },
      { runId: RUN_B, sendableLines: 9 } as ExecutionArtifactV1,
      recorded.slots.generation,
      NOW,
    );
    expect(next.slots.recoveryCapsule).toBeNull();

    // The tracker's second terminal for A, from the stream disappearing.
    const repeated = interruptRunMutation(next.slots, RUN_ID, 2, interruption, NOW);
    expect(repeated).toEqual({ slots: next.slots, value: true });
  });

  it('still refuses to interrupt a run it never recorded', () => {
    const other = interruptRunMutation(emptyRecoverySlots(0), 'run-unknown', 1, interruption, NOW);
    expect(other.value).toBe(false);
  });
});

describe('settleLinkLossRestartMutation (ADR-398 Amendment 3)', () => {
  const BACKLOG = { ackedAtStatus: 1, queuedBlocks: 15, bound: 'planner-size' } as const;
  const waiting = (claimed = false): PersistedRecoverySlots => ({
    ...INTERRUPTED_SLOTS,
    revision: 2,
    recoveryCapsule: {
      ...INTERRUPTED_SLOTS.recoveryCapsule!,
      interruption: {
        kind: 'disconnect',
        message: 'Cable removed.',
        sentLines: 3,
        plannerBacklogIfRestarted: BACKLOG,
      },
      ...(claimed ? { claim: { attemptId: 'attempt', claimedAtIso: NOW } } : {}),
    },
  });
  const expected = { runId: RUN_ID, revision: 2 };

  it('gives the saved run the planner step-back when the controller restarted', () => {
    const result = settleLinkLossRestartMutation(expected, { sign: 'boot-banner', link: 'usb' })(
      waiting(),
    );
    expect(result.value).toBe(true);
    const capsule = result.slots.recoveryCapsule;
    expect(capsule?.revision).toBe(3);
    expect(capsule?.updatedAtIso).toBe(NOW);
    expect(capsule?.interruption).toMatchObject({ sentLines: 3, plannerBacklog: BACKLOG });
    expect(capsule?.interruption).not.toHaveProperty('plannerBacklogIfRestarted');
  });

  it('drops the held-back backlog when the controller kept running', () => {
    const result = settleLinkLossRestartMutation(expected, { sign: 'kept-running', link: 'usb' })(
      waiting(),
    );
    expect(result.slots.recoveryCapsule?.interruption).toEqual({
      kind: 'disconnect',
      message: 'Cable removed.',
      sentLines: 3,
    });
  });

  it('changes nothing for another revision, a claimed capsule or a settled record', () => {
    for (const [slots, args] of [
      [waiting(), { runId: RUN_ID, revision: 1 }],
      [waiting(), { runId: 'run-other', revision: 2 }],
      [waiting(true), expected],
      [INTERRUPTED_SLOTS, expected],
    ] as const) {
      expect(
        settleLinkLossRestartMutation(args, { sign: 'boot-banner', link: 'usb' })(slots),
      ).toEqual({
        slots,
        value: false,
      });
    }
  });
});

describe('recoveryClaimIsExpired', () => {
  const claim = { attemptId: 'a', claimedAtIso: '2026-07-15T10:00:00.000Z' };
  const claimedMs = Date.parse(claim.claimedAtIso);

  it('is active within the lease and expired at or past it', () => {
    expect(recoveryClaimIsExpired(claim, claimedMs + RECOVERY_CLAIM_LEASE_MS - 1)).toBe(false);
    expect(recoveryClaimIsExpired(claim, claimedMs + RECOVERY_CLAIM_LEASE_MS)).toBe(true);
  });

  it('fails closed (never expired) for an unparseable timestamp', () => {
    expect(recoveryClaimIsExpired({ attemptId: 'a', claimedAtIso: 'not-a-date' }, claimedMs)).toBe(
      false,
    );
  });
});
