// ADR-369 Amendment 1: the window that starts a run holds an exclusive Web Lock
// named for it until the run is neither pending nor active in that window. The
// browser drops the lock when the window closes, reloads or crashes, so another
// window can tell a run that is still streaming from one a dead window left
// behind without trusting timestamps. The same pattern as the autosave session
// lock (autosave-session-lock.ts).

import type { RunId } from './execution-artifact';
import type { RecoveryRepositorySnapshot } from './recovery-model';

const RECOVERY_RUN_LOCK_NAMESPACE = 'kerfdesk-recovery-active-run';

export type RecoveryRunProbe<T> =
  | { readonly kind: 'reconciled'; readonly value: T }
  | { readonly kind: 'live' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'failed'; readonly error: unknown };

export class RecoveryRunLocks {
  private readonly manager: LockManager | undefined;
  private readonly held = new Map<RunId, () => void>();

  constructor(manager: LockManager | null | undefined = availableLockManager()) {
    this.manager = manager ?? undefined;
  }

  /** Holds the run's lock until `releaseAllExcept` drops it. Resolves once the
   * lock is held, or at once when locks are unavailable or already held here. */
  async hold(runId: RunId): Promise<void> {
    const manager = this.manager;
    if (manager === undefined || this.held.has(runId)) return;
    let releaseHold = (): void => undefined;
    const holding = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    this.held.set(runId, releaseHold);
    await new Promise<void>((acquired) => {
      manager
        .request(
          recoveryRunLockName(runId),
          { mode: 'exclusive', ifAvailable: true },
          async (lock) => {
            acquired();
            // A fresh run id is never held elsewhere; if it is, that window owns it.
            if (lock === null) {
              if (this.held.get(runId) === releaseHold) this.held.delete(runId);
              return;
            }
            await holding;
          },
        )
        .catch(() => {
          if (this.held.get(runId) === releaseHold) this.held.delete(runId);
          acquired();
        });
    });
  }

  /** Releases every run lock this window holds except the runs in `keep`. */
  releaseAllExcept(keep: ReadonlySet<RunId>): void {
    for (const [runId, release] of this.held) {
      if (keep.has(runId)) continue;
      this.held.delete(runId);
      release();
    }
  }

  /** Runs `reconcile` holding the run's lock, unless a live window holds it. */
  async runIfAbandoned<T>(runId: RunId, reconcile: () => Promise<T>): Promise<RecoveryRunProbe<T>> {
    if (this.manager === undefined) return { kind: 'unsupported' };
    try {
      return await this.manager.request(
        recoveryRunLockName(runId),
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (lock === null) return { kind: 'live' } as const;
          return { kind: 'reconciled', value: await reconcile() } as const;
        },
      );
    } catch (error) {
      return { kind: 'failed', error };
    }
  }
}

/** One window's run locks: taken before a run is recorded as pending or active,
 * kept while it is either, dropped once it is neither. */
export class RecoveryRunOwnership {
  private readonly starting = new Set<RunId>();

  constructor(
    private readonly locks: RecoveryRunLocks,
    private readonly liveRuns: () => ReadonlyArray<RunId | undefined>,
  ) {}

  /** Holds the run's lock before `write` records the run, so no window that
   * initializes meanwhile mistakes it for one a dead window left behind. */
  async recording<T>(runId: RunId, write: () => Promise<T>): Promise<T> {
    this.starting.add(runId);
    try {
      await this.locks.hold(runId);
      return await write();
    } finally {
      this.starting.delete(runId);
      this.releaseSettled();
    }
  }

  releaseSettled(): void {
    const keep = new Set<RunId>(this.starting);
    for (const runId of this.liveRuns()) if (runId !== undefined) keep.add(runId);
    this.locks.releaseAllExcept(keep);
  }

  /** Runs `reconcile` for the run unless a live window still holds it; with no
   * run, or a live one, resolves `idle`. Without Web Locks nothing can tell a
   * live run from a dead one, so it reconciles as it always did. */
  async unlessLive<T>(
    runId: RunId | undefined,
    idle: T,
    reconcile: (runId: RunId) => Promise<T>,
  ): Promise<T> {
    if (runId === undefined) return idle;
    const probe = await this.locks.runIfAbandoned(runId, () => reconcile(runId));
    if (probe.kind === 'live') return idle;
    return probe.kind === 'reconciled' ? probe.value : reconcile(runId);
  }
}

/** This window's run ownership over `state`: locks follow the runs it records. */
export function ownRecoveryRuns(
  state: {
    readonly snapshot: RecoveryRepositorySnapshot;
    readonly subscribe: (listener: () => void) => () => void;
  },
  locks: RecoveryRunLocks = new RecoveryRunLocks(),
): RecoveryRunOwnership {
  const ownership = new RecoveryRunOwnership(locks, () => [
    state.snapshot.pendingStart?.runId,
    state.snapshot.activeRun?.runId,
  ]);
  state.subscribe(() => ownership.releaseSettled());
  return ownership;
}

export function recoveryRunLockName(runId: RunId): string {
  return `${RECOVERY_RUN_LOCK_NAMESPACE}:${runId}`;
}

function availableLockManager(): LockManager | undefined {
  try {
    return globalThis.navigator?.locks;
  } catch {
    return undefined;
  }
}
