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

type PendingTerminalEntry = {
  readonly terminal: PendingRecoveryTerminal;
  inFlight: Promise<RecoveryRepositoryResult<boolean>> | null;
};

export class RecoveryTerminalCoordinator {
  private readonly stagedRunIds = new Set<RunId>();
  private readonly pendingTerminals = new Map<RunId, PendingTerminalEntry>();

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

  stagedRuns(): ReadonlySet<RunId> {
    return new Set(this.stagedRunIds);
  }

  async settleOrDefer(
    runId: RunId,
    terminal: PendingRecoveryTerminal,
    persist: PersistTerminal,
    canDefer: () => boolean,
  ): Promise<RecoveryRepositoryResult<boolean>> {
    const canSettleAfterActivation = this.stagedRunIds.has(runId) && canDefer();
    if (!canSettleAfterActivation) return persist(runId, terminal);

    // Install the terminal before starting storage work. Activation can then
    // find this entry and await the same attempt instead of racing a duplicate
    // slot mutation against it.
    const entry = this.pendingTerminals.get(runId) ?? { terminal, inFlight: null };
    this.pendingTerminals.set(runId, entry);
    const first = await this.persistPending(runId, entry, persist);
    if (first.ok && first.value) {
      this.deletePending(runId, entry);
      return first;
    }

    // Close the ordering window where activation committed immediately before
    // the first terminal mutation. A concurrent activation shares this retry.
    const retry = await this.persistPending(runId, entry, persist);
    if (!retry.ok || !retry.value) return retry.ok ? { ok: true, value: true } : retry;
    this.deletePending(runId, entry);
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
    const entry = this.pendingTerminals.get(runId);
    if (entry === undefined) return activated;

    // Await an attempt already started by the terminal callback, then retry one
    // failure or pre-activation no-op. All callers share each per-run attempt.
    let settled = await this.persistPending(runId, entry, persist);
    if (!settled.ok || !settled.value) {
      settled = await this.persistPending(runId, entry, persist);
    }
    if (!settled.ok || !settled.value) return settled;
    this.deletePending(runId, entry);
    return activated;
  }

  private async persistPending(
    runId: RunId,
    entry: PendingTerminalEntry,
    persist: PersistTerminal,
  ): Promise<RecoveryRepositoryResult<boolean>> {
    if (entry.inFlight !== null) return entry.inFlight;
    const inFlight = Promise.resolve().then(() => persist(runId, entry.terminal));
    entry.inFlight = inFlight;
    try {
      return await inFlight;
    } finally {
      if (entry.inFlight === inFlight) entry.inFlight = null;
    }
  }

  private deletePending(runId: RunId, entry: PendingTerminalEntry): void {
    if (this.pendingTerminals.get(runId) === entry) this.pendingTerminals.delete(runId);
  }
}
