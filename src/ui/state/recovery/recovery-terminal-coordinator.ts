import type { JobInterruption } from '../../../core/recovery';
import type { RunId } from './execution-artifact';
import type { RecoveryRepositoryResult } from './recovery-model';

export type PendingRecoveryTerminal =
  | { readonly kind: 'completed'; readonly completedAtIso: string }
  | {
      readonly kind: 'interrupted';
      readonly ackedLines: number;
      readonly interruption: JobInterruption;
      readonly updatedAtIso: string;
    };

type PersistTerminal = (
  runId: RunId,
  terminal: PendingRecoveryTerminal,
) => Promise<RecoveryRepositoryResult<boolean>>;

export class RecoveryTerminalCoordinator {
  private readonly stagedRunIds = new Set<RunId>();
  private readonly pendingTerminals = new Map<RunId, PendingRecoveryTerminal>();

  noteStaged(runId: RunId): void {
    this.stagedRunIds.add(runId);
  }

  discardStaged(runId: RunId): void {
    this.stagedRunIds.delete(runId);
    this.pendingTerminals.delete(runId);
  }

  clear(): void {
    this.stagedRunIds.clear();
    this.pendingTerminals.clear();
  }

  isStaged(runId: RunId): boolean {
    return this.stagedRunIds.has(runId);
  }

  async settleOrDefer(
    runId: RunId,
    terminal: PendingRecoveryTerminal,
    persist: PersistTerminal,
    canDefer: () => boolean,
  ): Promise<RecoveryRepositoryResult<boolean>> {
    const first = await persist(runId, terminal);
    if (!first.ok || first.value || !this.stagedRunIds.has(runId) || !canDefer()) return first;

    // The streamer is visible before its first accepted transport write
    // resolves. Do not disturb an older capsule until activation proves that
    // the new machine stream was accepted.
    this.pendingTerminals.set(runId, terminal);

    // Close the ordering window where activation committed immediately before
    // the deferred marker was installed. If it is still pending, activation
    // consumes the marker instead.
    const retry = await persist(runId, terminal);
    if (!retry.ok || !retry.value) return retry.ok ? { ok: true, value: true } : retry;
    this.pendingTerminals.delete(runId);
    return retry;
  }

  async finishActivation(
    runId: RunId,
    activated: RecoveryRepositoryResult<boolean>,
    persist: PersistTerminal,
  ): Promise<RecoveryRepositoryResult<boolean>> {
    if (!activated.ok || !activated.value) {
      this.discardStaged(runId);
      return activated;
    }
    this.stagedRunIds.delete(runId);
    const terminal = this.pendingTerminals.get(runId);
    if (terminal === undefined) return activated;

    // Retry one transient storage failure. Neither failure may refuse or pause
    // the already accepted machine stream.
    let settled = await persist(runId, terminal);
    if (!settled.ok) settled = await persist(runId, terminal);
    if (settled.ok && settled.value) this.pendingTerminals.delete(runId);
    return activated;
  }
}
