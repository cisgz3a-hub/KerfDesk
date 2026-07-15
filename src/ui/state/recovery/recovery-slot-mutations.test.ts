import { describe, expect, it } from 'vitest';
import type { ExecutionArtifactV1 } from './execution-artifact';
import { emptyRecoverySlots, type PersistedRecoverySlots } from './recovery-model';
import { activateClaimedRecoveryMutation } from './recovery-slot-mutations';

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
