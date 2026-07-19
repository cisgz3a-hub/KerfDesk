import type { ExecutionArtifactV1, RunId } from './execution-artifact';
import type { RecoveryArtifactStore } from './recovery-artifact-store';
import {
  type PersistedRecoverySlots,
  type RecoveryRepositoryResult,
  type StoredRecoveryArtifact,
} from './recovery-model';
import {
  activateClaimedRecoveryMutation,
  activateFreshRunMutation,
  type SlotMutation,
} from './recovery-slot-mutations';
import type { RecoveryTerminalCoordinator } from './recovery-terminal-coordinator';

export class RecoveryActivationCoordinator {
  constructor(
    private readonly options: {
      readonly artifactStore: RecoveryArtifactStore;
      readonly terminalCoordinator: RecoveryTerminalCoordinator;
      readonly persistTerminal: Parameters<RecoveryTerminalCoordinator['finishActivation']>[2];
      readonly mutate: <T>(
        operation: string,
        mutate: (slots: PersistedRecoverySlots) => SlotMutation<T>,
        additionalArtifacts?: ReadonlyArray<StoredRecoveryArtifact>,
        requiredArtifactRunId?: RunId,
      ) => Promise<RecoveryRepositoryResult<T>>;
    },
  ) {}

  async fresh(runId: RunId, acceptedAtIso: string): Promise<RecoveryRepositoryResult<boolean>> {
    const record = await this.options.artifactStore.exact(runId);
    if (!record.ok) return record;
    const activated = await this.options.mutate(
      'activate job recovery tracking',
      (slots) =>
        activateFreshRunMutation(
          slots,
          record.value.artifact as ExecutionArtifactV1,
          record.value.generation,
          acceptedAtIso,
        ),
      [record.value],
      runId,
    );
    return this.finish(runId, activated);
  }

  async claimed(args: {
    readonly sourceRunId: RunId;
    readonly sourceRevision: number;
    readonly attemptId: string;
    readonly recoveryRunId: RunId;
    readonly acceptedAtIso: string;
  }): Promise<RecoveryRepositoryResult<boolean>> {
    const record = await this.options.artifactStore.exact(args.recoveryRunId);
    if (!record.ok) return record;
    const activated = await this.options.mutate(
      'activate supervised recovery run',
      (slots) =>
        activateClaimedRecoveryMutation(slots, {
          sourceRunId: args.sourceRunId,
          sourceRevision: args.sourceRevision,
          attemptId: args.attemptId,
          artifact: record.value.artifact as ExecutionArtifactV1,
          artifactGeneration: record.value.generation,
          acceptedAtIso: args.acceptedAtIso,
        }),
      [record.value],
      args.recoveryRunId,
    );
    return this.finish(args.recoveryRunId, activated);
  }

  private async finish(
    runId: RunId,
    activated: RecoveryRepositoryResult<boolean>,
  ): Promise<RecoveryRepositoryResult<boolean>> {
    const finished = await this.options.terminalCoordinator.finishActivation(
      runId,
      activated,
      this.options.persistTerminal,
    );
    if (activated.ok && activated.value) this.options.artifactStore.releaseStaged(runId);
    return finished;
  }
}
