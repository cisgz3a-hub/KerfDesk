// Fingerprint-only capsules the repository writes itself: an ADR-118 legacy
// checkpoint migrated at start-up, and a laser run too large for the exact
// archive that was interrupted (ADR-341 Amendment 8).

import type { JobCheckpoint } from '../../../core/recovery';
import type { LegacyFingerprintOnlyArtifactV1, RunId } from './execution-artifact';
import {
  legacyArtifact,
  readLegacyCheckpoint,
  type LegacyCheckpointStorage,
} from './legacy-checkpoint-migration';
import type { RecoveryStorageBackend } from './recovery-backend';
import { insertLegacyRecoveryCapsule } from './recovery-legacy-insert';
import type { RecoveryRepositoryResult } from './recovery-model';
import { recoveryFailure as failure, recoveryOk as ok } from './recovery-result';
import type { PendingRecoveryTerminal } from './recovery-terminal-coordinator';
import {
  untrackedRunArtifact,
  untrackedRunCheckpoint,
  type UntrackedRunRecord,
} from './untracked-run-record';

type FingerprintCapsuleDeps = {
  readonly backend: RecoveryStorageBackend;
  readonly generation: number;
  readonly nowIso: string;
  readonly refresh: () => Promise<void>;
  readonly storageFailure: (operation: string, error: unknown) => RecoveryRepositoryResult<boolean>;
};

type InterruptedTerminal = Extract<PendingRecoveryTerminal, { readonly kind: 'interrupted' }>;

export class RecoveryFingerprintCapsules {
  private untrackedRun: UntrackedRunRecord | null = null;
  /** An interruption no slot took, kept until the run it belongs to is known:
   * a link can drop while Start is still building the archive it gives up on. */
  private unclaimedInterruption: {
    readonly runId: RunId;
    readonly terminal: InterruptedTerminal;
  } | null = null;

  constructor(private readonly deps: () => FingerprintCapsuleDeps) {}

  migrateLegacy(storage: LegacyCheckpointStorage): Promise<RecoveryRepositoryResult<boolean>> {
    const checkpoint = readLegacyCheckpoint(storage);
    if (checkpoint === null) return Promise.resolve(ok(false));
    return this.insert(
      legacyArtifact(checkpoint, this.deps().nowIso),
      checkpoint,
      'migrate legacy job checkpoint',
      () => storage.clear(),
    );
  }

  /** The run Start accepted without an archive, once its slots are cleared;
   * null forgets the previous one. An interruption that arrived first is
   * written now. */
  async rememberUntracked(
    record: UntrackedRunRecord | null,
  ): Promise<RecoveryRepositoryResult<boolean>> {
    this.untrackedRun = record;
    const early = this.unclaimedInterruption;
    this.unclaimedInterruption = null;
    if (record === null || early?.runId !== record.runId) return ok(false);
    this.untrackedRun = null;
    return this.writeInterrupted(record, early.terminal);
  }

  /** After a terminal found no active run: an interrupted run remembered as
   * untracked leaves a fingerprint-only capsule instead of nothing. */
  async afterTerminal(
    runId: RunId,
    terminal: PendingRecoveryTerminal,
    settled: RecoveryRepositoryResult<boolean>,
  ): Promise<RecoveryRepositoryResult<boolean>> {
    if (!settled.ok || settled.value) return settled;
    const untracked = this.untrackedRun;
    if (untracked?.runId !== runId) {
      if (terminal.kind === 'interrupted') this.unclaimedInterruption = { runId, terminal };
      return settled;
    }
    this.untrackedRun = null;
    return terminal.kind === 'interrupted' ? this.writeInterrupted(untracked, terminal) : settled;
  }

  private writeInterrupted(
    record: UntrackedRunRecord,
    terminal: InterruptedTerminal,
  ): Promise<RecoveryRepositoryResult<boolean>> {
    const { ackedLines, interruption, updatedAtIso } = terminal;
    return this.insert(
      untrackedRunArtifact(record, this.deps().nowIso),
      untrackedRunCheckpoint(record, ackedLines, interruption, updatedAtIso),
      'record interrupted job too large to archive',
    );
  }

  private async insert(
    artifact: LegacyFingerprintOnlyArtifactV1,
    checkpoint: JobCheckpoint,
    operation: string,
    onStored: () => void = () => undefined,
  ): Promise<RecoveryRepositoryResult<boolean>> {
    const deps = this.deps();
    try {
      const inserted = await insertLegacyRecoveryCapsule({
        backend: deps.backend,
        generation: deps.generation,
        artifact,
        checkpoint,
      });
      if (inserted === 'conflict') return failure('conflict');
      onStored();
      await deps.refresh();
      return ok(inserted === 'inserted');
    } catch (error) {
      return deps.storageFailure(operation, error);
    }
  }
}
