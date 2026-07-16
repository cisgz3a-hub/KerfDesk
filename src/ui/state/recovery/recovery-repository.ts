import type { JobInterruption } from '../../../core/recovery';
import type { ExecutionArtifactV1, RunId } from './execution-artifact';
import { legacyArtifact, readLegacyCheckpoint } from './legacy-checkpoint-migration';
import { cleanupDisplacedRecoveryArtifacts } from './recovery-artifact-cleanup';
import { RecoveryArtifactStore } from './recovery-artifact-store';
import { insertLegacyRecoveryCapsule } from './recovery-legacy-insert';
import { compensateFailedRecoveryClaim } from './recovery-claim-compensation';
import {
  UNLOADED_RECOVERY_SNAPSHOT,
  validRecoverySlots,
  type PersistedRecoverySlots,
  type RecoveryCapsule,
  type RecoveryRepositoryResult,
  type RecoveryRepositorySnapshot,
  type StoredRecoveryArtifact,
} from './recovery-model';
import {
  activateFreshRunMutation,
  activateClaimedRecoveryMutation,
  claimRecoveryMutation,
  completeRunMutation,
  discardCompletedReceiptMutation,
  discardRecoveryMutation,
  interruptRunMutation,
  noteUntrackedRunAcceptedMutation,
  promoteStaleActiveRunMutation,
  releaseRecoveryClaimMutation,
  updateProgressMutation,
} from './recovery-slot-mutations';
import { hydrateRecoverySnapshot } from './recovery-snapshot';
import {
  recoveryErrorMessage as errorMessage,
  recoveryFailure as failure,
  recoveryOk as ok,
} from './recovery-result';
import {
  RecoveryTerminalCoordinator,
  type PendingRecoveryTerminal,
} from './recovery-terminal-coordinator';
import type { RecoveryRepositoryOptions } from './recovery-repository-options';
import { RecoveryStartHandoff } from './recovery-start-handoff';

export type {
  RecoveryRepositoryOptions,
  RecoveryRepositoryWarning,
} from './recovery-repository-options';

type SnapshotListener = () => void;

export class RecoveryRepository {
  private snapshot: RecoveryRepositorySnapshot = UNLOADED_RECOVERY_SNAPSHOT;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly terminalCoordinator = new RecoveryTerminalCoordinator();
  private readonly nowIso: () => string;
  private initialization: Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>> | null =
    null;
  private readonly artifactStore: RecoveryArtifactStore;
  private readonly startHandoff: RecoveryStartHandoff;

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
      exactArtifactRecord: (runId) => this.exactArtifactRecord(runId),
      mutate: (operation, mutate) => this.mutateAndRefresh(operation, mutate),
      refresh: this.refresh.bind(this),
    });
  }

  getSnapshot = (): RecoveryRepositorySnapshot => this.snapshot;

  subscribe = (listener: SnapshotListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  initialize(): Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  async refresh(): Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>> {
    try {
      const marker = this.options.generationStore.read();
      const rawSlots = await this.options.backend.readSlots();
      const slots = validRecoverySlots(rawSlots, marker);
      if (slots.generation > marker) this.options.generationStore.write(slots.generation);
      this.publish(await hydrateRecoverySnapshot(this.options.backend, slots));
      return ok(this.snapshot);
    } catch (error) {
      return this.storageFailure('read recovery data', error);
    }
  }

  async stageArtifact(artifact: ExecutionArtifactV1): Promise<RecoveryRepositoryResult<RunId>> {
    return this.artifactStore.stage(artifact);
  }

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
    const record = await this.exactArtifactRecord(runId);
    if (!record.ok) return record;
    const activated = await this.mutateAndRefresh('activate job recovery tracking', (slots) =>
      activateFreshRunMutation(
        slots,
        record.value.artifact as ExecutionArtifactV1,
        record.value.generation,
        acceptedAtIso,
      ),
    );
    return this.terminalCoordinator.finishActivation(runId, activated, this.persistTerminal);
  }

  async updateProgress(
    runId: RunId,
    ackedLines: number,
    updatedAtIso = this.nowIso(),
  ): Promise<RecoveryRepositoryResult<boolean>> {
    return this.mutateAndRefresh('update job recovery progress', (slots) =>
      updateProgressMutation(slots, runId, ackedLines, updatedAtIso),
    );
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
      () => this.snapshot.activeRun === null || this.snapshot.activeRun.runId === runId,
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
      () => this.snapshot.activeRun === null || this.snapshot.activeRun.runId === runId,
    );
  }

  async noteUntrackedRunAccepted(): Promise<RecoveryRepositoryResult<boolean>> {
    const result = await this.mutateAndRefresh(
      'supersede recovery after untracked Start',
      noteUntrackedRunAcceptedMutation,
    );
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
    const capsule = this.snapshot.recoveryCapsule;
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
    const record = await this.exactArtifactRecord(args.recoveryRunId);
    if (!record.ok) return record;
    const activated = await this.mutateAndRefresh('activate supervised recovery run', (slots) =>
      activateClaimedRecoveryMutation(slots, {
        sourceRunId: args.sourceRunId,
        sourceRevision: args.sourceRevision,
        attemptId: args.attemptId,
        artifact: record.value.artifact as ExecutionArtifactV1,
        artifactGeneration: record.value.generation,
        acceptedAtIso: args.acceptedAtIso ?? this.nowIso(),
      }),
    );
    return this.terminalCoordinator.finishActivation(
      args.recoveryRunId,
      activated,
      this.persistTerminal,
    );
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
    this.startHandoff.clearTimer();
    const generation = Math.max(this.snapshot.generation, this.options.generationStore.read()) + 1;
    const markerWritten = this.options.generationStore.write(generation);
    this.options.legacyStorage.clear();
    this.publish({
      loaded: true,
      generation,
      activeRun: null,
      recoveryCapsule: null,
      lastCompletedReceipt: null,
      pendingStart: null,
    });
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
    const reconciled = await this.startHandoff.reconcile();
    if (!reconciled.ok) return reconciled;
    const promoted = await this.promoteStaleActiveRun();
    if (!promoted.ok) return promoted;
    const migrated = await this.migrateLegacyCheckpoint();
    return migrated.ok ? ok(this.snapshot) : migrated;
  }

  private async promoteStaleActiveRun(): Promise<RecoveryRepositoryResult<boolean>> {
    if (this.snapshot.activeRun === null) return ok(false);
    return this.mutateAndRefresh('promote stale active run to recovery', (slots) =>
      promoteStaleActiveRunMutation(slots, this.nowIso()),
    );
  }

  private async ensureLoaded(): Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>> {
    return this.snapshot.loaded ? ok(this.snapshot) : this.refresh();
  }

  private currentGeneration(): number {
    return Math.max(this.snapshot.generation, this.options.generationStore.read());
  }

  private async exactArtifactRecord(
    runId: RunId,
  ): Promise<RecoveryRepositoryResult<StoredRecoveryArtifact>> {
    return this.artifactStore.exact(runId);
  }

  private async mutateAndRefresh<T>(
    operation: string,
    mutate: (slots: PersistedRecoverySlots) => {
      readonly slots: PersistedRecoverySlots;
      readonly value: T;
    },
  ): Promise<RecoveryRepositoryResult<T>> {
    const ready = await this.ensureLoaded();
    if (!ready.ok) return ready;
    try {
      const before = this.snapshot;
      const generation = this.currentGeneration();
      const value = await this.options.backend.mutateSlots((raw) =>
        mutate(validRecoverySlots(raw, generation)),
      );
      await this.refreshAfterMutation();
      await cleanupDisplacedRecoveryArtifacts({
        backend: this.options.backend,
        before,
        after: this.snapshot,
        isStaged: (runId) => this.terminalCoordinator.isStaged(runId),
        onFailure: (error) =>
          this.warn('clean up superseded recovery artifact', errorMessage(error)),
      });
      return ok(value);
    } catch (error) {
      return this.storageFailure(operation, error);
    }
  }

  private async refreshAfterMutation(): Promise<void> {
    const refreshed = await this.refresh();
    if (!refreshed.ok) throw new Error('Recovery data was written but could not be reloaded.');
  }

  private persistTerminal = (
    runId: RunId,
    terminal: PendingRecoveryTerminal,
  ): Promise<RecoveryRepositoryResult<boolean>> => {
    return terminal.kind === 'completed'
      ? this.mutateAndRefresh('complete job recovery tracking', (slots) =>
          completeRunMutation(slots, runId, terminal.completedAtIso),
        )
      : this.mutateAndRefresh('save interrupted job recovery', (slots) =>
          interruptRunMutation(
            slots,
            runId,
            terminal.ackedLines,
            terminal.interruption,
            terminal.updatedAtIso,
          ),
        );
  };

  private publish(snapshot: RecoveryRepositorySnapshot): void {
    if (snapshot.pendingStart === null) this.startHandoff.clearTimer();
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private storageFailure<T>(operation: string, error: unknown): RecoveryRepositoryResult<T> {
    this.warn(operation, errorMessage(error));
    return failure('storage-unavailable');
  }

  private warn(operation: string, message: string): void {
    this.options.onWarning?.({ operation, message });
  }
}
