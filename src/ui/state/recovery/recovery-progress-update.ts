import type { RecoveryStorageBackend } from './recovery-backend';
import {
  parseRecoverySlots,
  type ActiveRunRecord,
  type PersistedRecoverySlots,
  type RecoveryRepositoryResult,
  type RecoveryRepositorySnapshot,
} from './recovery-model';
import { updateProgressMutation } from './recovery-slot-mutations';
import { recoveryOk as ok } from './recovery-result';
import type { RecoveryRepositoryState } from './recovery-repository-state';
import type { RecoveryAuthoritativeResetBase } from './recovery-repository-state';

export class RecoveryProgressCoordinator {
  constructor(
    private readonly options: {
      readonly backend: RecoveryStorageBackend;
      readonly state: RecoveryRepositoryState;
      readonly minimumGeneration: () => number;
      readonly ensureLoaded: () => Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>>;
      readonly refreshAfterMutation: (
        authoritativeResetBase?: RecoveryAuthoritativeResetBase,
      ) => Promise<void>;
      readonly afterFallback: (
        before: RecoveryRepositorySnapshot,
        after: RecoveryRepositorySnapshot,
      ) => Promise<void>;
      readonly storageFailure: (error: unknown) => RecoveryRepositoryResult<boolean>;
    },
  ) {}

  async update(
    runId: string,
    ackedLines: number,
    updatedAtIso: string,
  ): Promise<RecoveryRepositoryResult<boolean>> {
    const ready = await this.options.ensureLoaded();
    if (!ready.ok) return ready;
    const before = this.options.state.snapshot;
    const localRevision = this.options.state.slotRevision;
    try {
      const commit = await commitRecoveryProgress({
        backend: this.options.backend,
        minimumGeneration: this.options.minimumGeneration(),
        localSnapshot: before,
        localRevision,
        runId,
        ackedLines,
        updatedAtIso,
      });
      const generationIsCurrent = commit.baseGeneration >= this.options.minimumGeneration();
      if (
        generationIsCurrent &&
        commit.snapshot !== null &&
        this.options.state.isCurrent(before, localRevision)
      ) {
        this.options.state.publish(commit.snapshot, commit.committedRevision);
      } else {
        await this.options.refreshAfterMutation(
          commit.baseAccepted ? undefined : { snapshot: before, slotRevision: localRevision },
        );
        await this.options.afterFallback(before, this.options.state.snapshot);
      }
      return ok(commit.value);
    } catch (error) {
      return this.options.storageFailure(error);
    }
  }
}

export type RecoveryProgressCommit = {
  readonly value: boolean;
  readonly baseGeneration: number;
  readonly baseRevision: number;
  readonly baseAccepted: boolean;
  readonly committedRevision: number;
  readonly snapshot: RecoveryRepositorySnapshot | null;
};

export async function commitRecoveryProgress(args: {
  readonly backend: RecoveryStorageBackend;
  readonly minimumGeneration: number;
  readonly localSnapshot: RecoveryRepositorySnapshot;
  readonly localRevision: number | null;
  readonly runId: string;
  readonly ackedLines: number;
  readonly updatedAtIso: string;
}): Promise<RecoveryProgressCommit> {
  const commit = await args.backend.mutateSlots((raw) => {
    const parsed = parseRecoverySlots(raw, args.minimumGeneration);
    const base = parsed.slots;
    const mutation = updateProgressMutation(base, args.runId, args.ackedLines, args.updatedAtIso);
    return {
      slots: mutation.slots,
      value: progressCommitValue(base, mutation.slots, mutation.value, parsed.accepted),
    };
  });
  return {
    ...commit,
    snapshot: fastProgressSnapshot(args.localSnapshot, args.localRevision, commit),
  };
}

type ProgressCommitValue = Omit<RecoveryProgressCommit, 'snapshot'> & {
  readonly baseActiveRun: ActiveRunRecord | null;
  readonly committedActiveRun: ActiveRunRecord | null;
};

function progressCommitValue(
  base: PersistedRecoverySlots,
  committed: PersistedRecoverySlots,
  value: boolean,
  baseAccepted: boolean,
): ProgressCommitValue {
  return {
    value,
    baseGeneration: base.generation,
    baseRevision: base.revision,
    baseAccepted,
    baseActiveRun: base.activeRun,
    committedRevision: committed.revision,
    committedActiveRun: committed.activeRun,
  };
}

function fastProgressSnapshot(
  local: RecoveryRepositorySnapshot,
  localRevision: number | null,
  commit: ProgressCommitValue,
): RecoveryRepositorySnapshot | null {
  if (
    local.generation !== commit.baseGeneration ||
    localRevision !== commit.baseRevision ||
    !activeRunMatches(local.activeRun, commit.baseActiveRun)
  ) {
    return null;
  }
  if (commit.baseActiveRun === null || commit.committedActiveRun === null) {
    return commit.baseActiveRun === commit.committedActiveRun ? local : null;
  }
  if (local.activeRun === null || local.activeRun.runId !== commit.committedActiveRun.runId) {
    return null;
  }
  return {
    ...local,
    activeRun: { ...commit.committedActiveRun, artifact: local.activeRun.artifact },
  };
}

function activeRunMatches(
  local: RecoveryRepositorySnapshot['activeRun'],
  persisted: ActiveRunRecord | null,
): boolean {
  if (local === null || persisted === null) return local === persisted;
  return (
    local.runId === persisted.runId &&
    local.ackedLines === persisted.ackedLines &&
    local.sendableLines === persisted.sendableLines &&
    local.startedAtIso === persisted.startedAtIso &&
    local.updatedAtIso === persisted.updatedAtIso &&
    local.estimatedArtifactBytes === persisted.estimatedArtifactBytes
  );
}
