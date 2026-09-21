import type { ExecutionArtifactV1, RunId } from './execution-artifact';
import type {
  PersistedRecoverySlots,
  RecoveryRepositoryResult,
  RecoveryRepositorySnapshot,
  StoredRecoveryArtifact,
} from './recovery-model';
import type { JobCheckpoint } from '../../../core/recovery';
import {
  armClaimedRecoveryStartMutation,
  armFreshStartIntentMutation,
  armFreshStartMutation,
  cancelPendingStartMutation,
  reconcilePendingStartMutation,
} from './recovery-start-handoff-mutations';
import { recoveryOk as ok } from './recovery-result';

const PENDING_START_OWNER_LEASE_MS = 5_000;

type HandoffHost = {
  readonly nowIso: () => string;
  readonly getSnapshot: () => RecoveryRepositorySnapshot;
  readonly exactArtifactRecord: (
    runId: RunId,
  ) => Promise<RecoveryRepositoryResult<StoredRecoveryArtifact>>;
  readonly mutate: <T>(
    operation: string,
    mutate: (slots: PersistedRecoverySlots) => {
      readonly slots: PersistedRecoverySlots;
      readonly value: T;
    },
    requiredArtifactRunId?: RunId,
  ) => Promise<RecoveryRepositoryResult<T>>;
  readonly refresh: () => Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>>;
  /** Materialize the fingerprint-only artifact an intent-armed handoff stands
   * for, so the capsule reconciliation writes has something to point at.
   * Resolves false when the artifact could not be written. */
  readonly materializeIntentArtifact: (runId: RunId, intent: JobCheckpoint) => Promise<boolean>;
};

export class RecoveryStartHandoff {
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: HandoffHost) {}

  async armFreshStart(
    runId: RunId,
    armedAtIso = this.host.nowIso(),
  ): Promise<RecoveryRepositoryResult<boolean>> {
    const record = await this.host.exactArtifactRecord(runId);
    if (!record.ok) return record;
    return this.host.mutate(
      'arm durable job Start handoff',
      (slots) =>
        armFreshStartMutation(
          slots,
          record.value.artifact as ExecutionArtifactV1,
          record.value.generation,
          armedAtIso,
        ),
      runId,
    );
  }

  /** ADR-337: arm before the archive exists. The intent alone is enough to
   * tell the operator, after a crash, which program was handed over and how
   * long it was — which is the whole job of this record. */
  armFreshStartIntent(
    runId: RunId,
    intent: JobCheckpoint,
    armedAtIso = this.host.nowIso(),
  ): Promise<RecoveryRepositoryResult<boolean>> {
    return this.host.mutate('arm durable job Start intent', (slots) =>
      armFreshStartIntentMutation(slots, runId, intent, armedAtIso),
    );
  }

  async armClaimedRecoveryStart(args: {
    readonly sourceRunId: RunId;
    readonly sourceRevision: number;
    readonly attemptId: string;
    readonly recoveryRunId: RunId;
    readonly armedAtIso?: string;
  }): Promise<RecoveryRepositoryResult<boolean>> {
    const record = await this.host.exactArtifactRecord(args.recoveryRunId);
    if (!record.ok) return record;
    return this.host.mutate(
      'arm durable supervised recovery handoff',
      (slots) =>
        armClaimedRecoveryStartMutation(slots, {
          sourceRunId: args.sourceRunId,
          sourceRevision: args.sourceRevision,
          attemptId: args.attemptId,
          artifact: record.value.artifact as ExecutionArtifactV1,
          artifactGeneration: record.value.generation,
          armedAtIso: args.armedAtIso ?? this.host.nowIso(),
        }),
      args.recoveryRunId,
    );
  }

  cancel(runId: RunId): Promise<RecoveryRepositoryResult<boolean>> {
    return this.host.mutate('cancel unaccepted durable Start handoff', (slots) =>
      cancelPendingStartMutation(slots, runId),
    );
  }

  async reconcile(): Promise<RecoveryRepositoryResult<boolean>> {
    const pending = this.host.getSnapshot().pendingStart;
    if (pending === null) return ok(false);
    const remainingLeaseMs =
      Date.parse(pending.armedAtIso) +
      PENDING_START_OWNER_LEASE_MS -
      Date.parse(this.host.nowIso());
    if (Number.isFinite(remainingLeaseMs) && remainingLeaseMs > 0) {
      this.scheduleReconciliation(Math.min(remainingLeaseMs, PENDING_START_OWNER_LEASE_MS));
      return ok(false);
    }
    return this.reconcileNow();
  }

  clearTimer(): void {
    if (this.reconcileTimer === null) return;
    clearTimeout(this.reconcileTimer);
    this.reconcileTimer = null;
  }

  private scheduleReconciliation(delayMs: number): void {
    if (this.reconcileTimer !== null) return;
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      void this.host.refresh().then((refreshed) => {
        if (refreshed.ok) void this.reconcileNow();
      });
    }, delayMs);
  }

  private async reconcileNow(): Promise<RecoveryRepositoryResult<boolean>> {
    // An intent-armed handoff has no archive yet, so the capsule it becomes
    // would reference a run with no artifact and be dropped on the next
    // hydration — silence, exactly where the operator most needs to be told
    // the machine may have moved. Write the fingerprint-only stand-in first.
    const pending = this.host.getSnapshot().pendingStart;
    if (pending?.intent !== undefined) {
      const materialized = await this.host.materializeIntentArtifact(pending.runId, pending.intent);
      if (!materialized) return ok(false);
    }
    return this.host.mutate('reconcile uncertain Start handoff', (slots) =>
      reconcilePendingStartMutation(slots, this.host.nowIso()),
    );
  }
}
