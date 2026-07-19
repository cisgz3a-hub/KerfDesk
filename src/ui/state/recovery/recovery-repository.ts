import type { JobInterruption } from '../../../core/recovery';
import type { ExecutionArtifactV1, RunId } from './execution-artifact';
import { RecoveryActivationCoordinator } from './recovery-activation-coordinator';
import { legacyArtifact, readLegacyCheckpoint } from './legacy-checkpoint-migration';
import { RecoveryArtifactCleanupCoordinator } from './recovery-artifact-cleanup-coordinator';
import { RecoveryArtifactStore } from './recovery-artifact-store';
import { insertLegacyRecoveryCapsule } from './recovery-legacy-insert';
import { compensateFailedRecoveryClaim } from './recovery-claim-compensation';
import {
  type PersistedRecoverySlots,
  type RecoveryCapsule,
  type RecoveryRepositoryResult,
  type RecoveryRepositorySnapshot,
  type StoredRecoveryArtifact,
} from './recovery-model';
import {
  claimRecoveryMutation,
  discardCompletedReceiptMutation,
  discardRecoveryMutation,
  noteUntrackedRunAcceptedMutation,
  promoteStaleActiveRunMutation,
  releaseRecoveryClaimMutation,
} from './recovery-slot-mutations';
import {
  recoveryErrorMessage as errorMessage,
  recoveryFailure as failure,
  recoveryOk as ok,
} from './recovery-result';
import {
  RecoveryTerminalCoordinator,
  type PendingRecoveryTerminal,
} from './recovery-terminal-coordinator';
import { recoveryTerminalPersistencePlan } from './recovery-terminal-persistence';
import type { RecoveryRepositoryOptions } from './recovery-repository-options';
import { RecoveryStartHandoff } from './recovery-start-handoff';
import { RecoveryProgressCoordinator } from './recovery-progress-update';
import { commitRecoverySlotMutation } from './recovery-mutation-commit';
import { sanitizeUnhydratedRecoveryReferences } from './recovery-owner-sanitizer';
import { RecoveryRepositoryState } from './recovery-repository-state';
import type { RecoveryAuthoritativeResetBase } from './recovery-repository-state';
import { RecoverySnapshotCoordinator } from './recovery-snapshot-coordinator';

export type {
  RecoveryRepositoryOptions,
  RecoveryRepositoryWarning,
} from './recovery-repository-options';

export class RecoveryRepository {
  private readonly state = new RecoveryRepositoryState(() => this.startHandoff.clearTimer());
  private readonly terminalCoordinator = new RecoveryTerminalCoordinator();
  private readonly nowIso: () => string;
  private initialization: Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>> | null =
    null;
  private readonly artifactStore: RecoveryArtifactStore;
  private readonly startHandoff: RecoveryStartHandoff;
  private readonly artifactCleanup: RecoveryArtifactCleanupCoordinator;
  private readonly progressCoordinator: RecoveryProgressCoordinator;
  private readonly snapshotCoordinator: RecoverySnapshotCoordinator;
  private readonly activationCoordinator: RecoveryActivationCoordinator;

  constructor(private readonly options: RecoveryRepositoryOptions) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.artifactStore = new RecoveryArtifactStore({
      backend: options.backend,
      currentGeneration: () => this.currentGeneration(),
      ensureLoaded: () => this.ensureLoaded(),
      snapshot: this.getSnapshot,
      noteStaged: (runId) => this.terminalCoordinator.noteStaged(runId),
      discardStaged: (runId) => this.terminalCoordinator.discardStaged(runId),
      storageFailure: (operation, error) => this.storageFailure(operation, error),
    });
    this.startHandoff = new RecoveryStartHandoff({
      nowIso: this.nowIso,
      getSnapshot: this.getSnapshot,
      exactArtifactRecord: (runId) => this.artifactStore.exact(runId),
      mutate: (operation, mutate, requiredArtifactRunId) =>
        this.mutateAndRefresh(operation, mutate, [], requiredArtifactRunId),
      refresh: this.refresh.bind(this),
    });
    this.artifactCleanup = new RecoveryArtifactCleanupCoordinator({
      backend: options.backend,
      isStaged: (runId) => this.terminalCoordinator.isStaged(runId),
      stagedRuns: () => this.terminalCoordinator.stagedRuns(),
      currentGeneration: () => this.currentGeneration(),
      onFailure: (operation, error) => this.warn(operation, errorMessage(error)),
    });
    this.snapshotCoordinator = new RecoverySnapshotCoordinator({
      backend: options.backend,
      generationStore: options.generationStore,
      state: this.state,
      storageFailure: (operation, error) => this.storageFailure(operation, error),
    });
    this.activationCoordinator = new RecoveryActivationCoordinator({
      artifactStore: this.artifactStore,
      terminalCoordinator: this.terminalCoordinator,
      persistTerminal: this.persistTerminal,
      mutate: (operation, mutate, additionalArtifacts, requiredArtifactRunId) =>
        this.mutateAndRefresh(operation, mutate, additionalArtifacts, requiredArtifactRunId),
    });
    this.progressCoordinator = new RecoveryProgressCoordinator({
      backend: options.backend,
      state: this.state,
      minimumGeneration: () => this.currentGeneration(),
      ensureLoaded: () => this.ensureLoaded(),
      refreshAfterMutation: (authoritativeResetBase) =>
        this.refreshAfterMutation([], authoritativeResetBase),
      afterFallback: (before, after) => this.artifactCleanup.afterMutation(before, after),
      storageFailure: (error) => this.storageFailure('update job recovery progress', error),
    });
  }

  getSnapshot = this.state.getSnapshot;
  subscribe = this.state.subscribe;

  initialize(): Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  refresh(): Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>> {
    return this.snapshotCoordinator.refresh();
  }

  stageArtifact = (artifact: ExecutionArtifactV1): Promise<RecoveryRepositoryResult<RunId>> =>
    this.artifactStore.stage(artifact);

  getArchivedExecution = (runId: RunId): Promise<RecoveryRepositoryResult<ExecutionArtifactV1>> =>
    this.artifactStore.archived(runId);

  async discardStagedRun(runId: RunId): Promise<RecoveryRepositoryResult<boolean>> {
    return this.artifactStore.discard(runId);
  }

  async armFreshStart(
    runId: RunId,
    armedAtIso = this.nowIso(),
  ): Promise<RecoveryRepositoryResult<boolean>> {
    return this.startHandoff.armFreshStart(runId, armedAtIso);
  }

  async armClaimedRecoveryStart(args: {
    readonly sourceRunId: RunId;
    readonly sourceRevision: number;
    readonly attemptId: string;
    readonly recoveryRunId: RunId;
    readonly armedAtIso?: string;
  }): Promise<RecoveryRepositoryResult<boolean>> {
    return this.startHandoff.armClaimedRecoveryStart(args);
  }

  async cancelPendingStart(runId: RunId): Promise<RecoveryRepositoryResult<boolean>> {
    return this.startHandoff.cancel(runId);
  }

  async activateFreshRun(
    runId: RunId,
    acceptedAtIso = this.nowIso(),
  ): Promise<RecoveryRepositoryResult<boolean>> {
    return this.activationCoordinator.fresh(runId, acceptedAtIso);
  }

  async updateProgress(
    runId: RunId,
    ackedLines: number,
    updatedAtIso = this.nowIso(),
  ): Promise<RecoveryRepositoryResult<boolean>> {
    return this.progressCoordinator.update(runId, ackedLines, updatedAtIso);
  }

  async interruptRun(
    runId: RunId,
    ackedLines: number,
    interruption: JobInterruption,
    updatedAtIso = this.nowIso(),
  ): Promise<RecoveryRepositoryResult<boolean>> {
    return this.terminalCoordinator.settleOrDefer(
      runId,
      { kind: 'interrupted', ackedLines, interruption, updatedAtIso },
      this.persistTerminal,
      () => this.state.snapshot.activeRun === null || this.state.snapshot.activeRun.runId === runId,
    );
  }

  async completeRun(
    runId: RunId,
    completedAtIso = this.nowIso(),
  ): Promise<RecoveryRepositoryResult<boolean>> {
    return this.terminalCoordinator.settleOrDefer(
      runId,
      { kind: 'completed', completedAtIso },
      this.persistTerminal,
      () => this.state.snapshot.activeRun === null || this.state.snapshot.activeRun.runId === runId,
    );
  }

  async noteUntrackedRunAccepted(runId?: RunId): Promise<RecoveryRepositoryResult<boolean>> {
    const result = await this.mutateAndRefresh(
      'supersede recovery after untracked Start',
      noteUntrackedRunAcceptedMutation,
    );
    if (result.ok && runId !== undefined) await this.artifactStore.discard(runId);
    if (result.ok) return result;
    const purged = await this.purgeControllerData();
    return purged.ok ? ok(true) : result;
  }

  async discardRecovery(expected?: {
    readonly runId: RunId;
    readonly revision: number;
  }): Promise<RecoveryRepositoryResult<boolean>> {
    return this.mutateAndRefresh('discard interrupted job recovery', (slots) =>
      discardRecoveryMutation(slots, expected),
    );
  }

  async discardCompletedReceipt(expectedRunId: RunId): Promise<RecoveryRepositoryResult<boolean>> {
    return this.mutateAndRefresh('discard completed-job replay receipt', (slots) =>
      discardCompletedReceiptMutation(slots, expectedRunId),
    );
  }

  async claimRecovery(args: {
    readonly runId: RunId;
    readonly revision: number;
    readonly attemptId: string;
    readonly claimedAtIso?: string;
  }): Promise<RecoveryRepositoryResult<RecoveryCapsule>> {
    const result = await this.mutateAndRefresh('claim interrupted job recovery', (slots) =>
      claimRecoveryMutation(slots, {
        ...args,
        claimedAtIso: args.claimedAtIso ?? this.nowIso(),
      }),
    );
    if (!result.ok) {
      // mutateSlots resolves only after its transaction commits, but the
      // hydration that follows can still fail. Compensate by attempt ID so an
      // API failure before controller acceptance never strands a durable
      // claim, while a different window's claim remains untouched.
      const compensated = await compensateFailedRecoveryClaim({
        backend: this.options.backend,
        minimumGeneration: this.currentGeneration(),
        runId: args.runId,
        attemptId: args.attemptId,
        updatedAtIso: this.nowIso(),
      });
      if (compensated.ok) {
        await this.refresh();
      } else {
        this.warn('release failed interrupted job recovery claim', errorMessage(compensated.error));
      }
      return result;
    }
    const capsule = this.state.snapshot.recoveryCapsule;
    return result.value && capsule?.claim?.attemptId === args.attemptId
      ? ok(capsule)
      : failure('conflict');
  }

  async releaseRecoveryClaim(
    runId: RunId,
    attemptId: string,
    updatedAtIso = this.nowIso(),
  ): Promise<RecoveryRepositoryResult<boolean>> {
    return this.mutateAndRefresh('release interrupted job recovery claim', (slots) =>
      releaseRecoveryClaimMutation(slots, runId, attemptId, updatedAtIso),
    );
  }

  async activateClaimedRecovery(args: {
    readonly sourceRunId: RunId;
    readonly sourceRevision: number;
    readonly attemptId: string;
    readonly recoveryRunId: RunId;
    readonly acceptedAtIso?: string;
  }): Promise<RecoveryRepositoryResult<boolean>> {
    return this.activationCoordinator.claimed({
      ...args,
      acceptedAtIso: args.acceptedAtIso ?? this.nowIso(),
    });
  }

  async migrateLegacyCheckpoint(): Promise<RecoveryRepositoryResult<boolean>> {
    const ready = await this.ensureLoaded();
    if (!ready.ok) return ready;
    const checkpoint = readLegacyCheckpoint(this.options.legacyStorage);
    if (checkpoint === null) return ok(false);
    const artifact = legacyArtifact(checkpoint, this.nowIso());
    try {
      const generation = this.currentGeneration();
      const inserted = await insertLegacyRecoveryCapsule({
        backend: this.options.backend,
        generation,
        artifact,
        checkpoint,
      });
      if (inserted === 'conflict') return failure('conflict');
      this.options.legacyStorage.clear();
      await this.refreshAfterMutation();
      return ok(inserted === 'inserted');
    } catch (error) {
      return this.storageFailure('migrate legacy job checkpoint', error);
    }
  }

  async purgeControllerData(): Promise<RecoveryRepositoryResult<number>> {
    this.terminalCoordinator.clear();
    this.artifactCleanup.clear();
    this.artifactStore.clear();
    this.snapshotCoordinator.clear();
    this.startHandoff.clearTimer();
    const generation =
      Math.max(this.state.snapshot.generation, this.options.generationStore.read()) + 1;
    const markerWritten = this.options.generationStore.write(generation);
    this.options.legacyStorage.clear();
    this.state.publish(
      {
        loaded: true,
        generation,
        activeRun: null,
        recoveryCapsule: null,
        lastCompletedReceipt: null,
        pendingStart: null,
        executionHistory: [],
      },
      0,
    );
    try {
      await this.options.backend.purge(generation);
      if (!markerWritten) {
        this.warn('write recovery deletion marker', 'The browser deletion marker was unavailable.');
      }
      return ok(generation);
    } catch (error) {
      return this.storageFailure('purge controller recovery data', error);
    }
  }

  private async initializeOnce(): Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>> {
    const loaded = await this.refresh();
    if (!loaded.ok) return loaded;
    const sanitized = await this.mutateAndRefresh(
      'drop invalid persisted recovery references',
      sanitizeUnhydratedRecoveryReferences(this.state.snapshot, this.state.slotRevision),
    );
    if (!sanitized.ok) return sanitized;
    const reconciled = await this.startHandoff.reconcile();
    if (!reconciled.ok) return reconciled;
    const promoted = await this.promoteStaleActiveRun();
    if (!promoted.ok) return promoted;
    const migrated = await this.migrateLegacyCheckpoint();
    if (!migrated.ok) return migrated;
    await this.artifactCleanup.afterInitialization();
    return ok(this.state.snapshot);
  }

  private async promoteStaleActiveRun(): Promise<RecoveryRepositoryResult<boolean>> {
    if (this.state.snapshot.activeRun === null) return ok(false);
    return this.mutateAndRefresh('promote stale active run to recovery', (slots) =>
      promoteStaleActiveRunMutation(slots, this.nowIso()),
    );
  }

  private async ensureLoaded(): Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>> {
    return this.state.snapshot.loaded ? ok(this.state.snapshot) : this.refresh();
  }

  private currentGeneration = (): number =>
    Math.max(this.state.snapshot.generation, this.options.generationStore.read());

  private async mutateAndRefresh<T>(
    operation: string,
    mutate: (slots: PersistedRecoverySlots) => {
      readonly slots: PersistedRecoverySlots;
      readonly value: T;
    },
    additionalArtifacts: ReadonlyArray<StoredRecoveryArtifact> = [],
    requiredArtifactRunId?: RunId,
  ): Promise<RecoveryRepositoryResult<T>> {
    const ready = await this.ensureLoaded();
    if (!ready.ok) return ready;
    try {
      const before = this.state.snapshot;
      const beforeRevision = this.state.slotRevision;
      const generation = this.currentGeneration();
      const committed = await commitRecoverySlotMutation({
        backend: this.options.backend,
        minimumGeneration: generation,
        ...(requiredArtifactRunId === undefined ? {} : { requiredArtifactRunId }),
        mutate,
      });
      if (!committed.artifactExists) return failure('not-found');
      await this.refreshAfterMutation(
        additionalArtifacts,
        committed.baseAccepted ? undefined : { snapshot: before, slotRevision: beforeRevision },
      );
      await this.artifactCleanup.afterMutation(before, this.state.snapshot);
      return ok(committed.value);
    } catch (error) {
      return this.storageFailure(operation, error);
    }
  }

  private async refreshAfterMutation(
    additionalArtifacts: ReadonlyArray<StoredRecoveryArtifact> = [],
    authoritativeResetBase?: RecoveryAuthoritativeResetBase,
  ): Promise<void> {
    const refreshed = await this.snapshotCoordinator.refresh({
      reuseVerifiedArtifacts: true,
      additionalArtifacts,
      ...(authoritativeResetBase === undefined ? {} : { authoritativeResetBase }),
    });
    if (!refreshed.ok) throw new Error('Recovery data was written but could not be reloaded.');
  }

  private persistTerminal = (
    runId: RunId,
    terminal: PendingRecoveryTerminal,
  ): Promise<RecoveryRepositoryResult<boolean>> => {
    const plan = recoveryTerminalPersistencePlan(runId, terminal);
    return this.mutateAndRefresh(plan.operation, plan.mutate);
  };

  private storageFailure<T>(operation: string, error: unknown): RecoveryRepositoryResult<T> {
    this.warn(operation, errorMessage(error));
    return failure('storage-unavailable');
  }

  private warn = (operation: string, message: string): void =>
    this.options.onWarning?.({ operation, message });
}
