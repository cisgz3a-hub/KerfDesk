import type { RunId } from './execution-artifact';
import type {
  PersistedRecoverySlots,
  RecoveryRepositoryResult,
  RecoveryRepositorySnapshot,
} from './recovery-model';
import { freshRunOwnershipMatches } from './fresh-run-ownership';
import { noteUntrackedRunAcceptedMutation } from './recovery-slot-mutations';
import type { UntrackedRunRecord } from './untracked-run-record';

type Result = RecoveryRepositoryResult<boolean>;
type Host = {
  snapshot: () => RecoveryRepositorySnapshot;
  mutate: (
    mutation: (slots: PersistedRecoverySlots) => { slots: PersistedRecoverySlots; value: boolean },
  ) => Promise<Result>;
  discard: (runId: RunId) => Promise<Result>;
  remember: (record: UntrackedRunRecord | null) => Promise<Result>;
  purge: () => Promise<RecoveryRepositoryResult<number>>;
};

export type UntrackedAcceptanceGuard = {
  readonly current: () => boolean;
};

/** A fallback mutation checks ownership again inside the storage transaction. */
export async function acceptUntrackedRun(
  host: Host,
  runId?: RunId,
  record?: UntrackedRunRecord,
  guard?: UntrackedAcceptanceGuard,
): Promise<Result> {
  const before = host.snapshot();
  const result = await host.mutate((slots) =>
    guard !== undefined && (!guard.current() || !freshRunOwnershipMatches(slots, before, runId))
      ? { slots, value: false }
      : noteUntrackedRunAcceptedMutation(slots),
  );
  if (superseded(guard, result)) return { ok: true, value: false };
  if (result.ok && runId !== undefined) await host.discard(runId);
  if (guard !== undefined && !guard.current()) return { ok: true, value: false };
  await host.remember(result.ok || guard !== undefined ? (record ?? null) : null);
  if (result.ok) return result;
  // A fresh accepted run can keep its exact copy while storage is unavailable.
  // Preserve its uncertain durable intent; a global purge could erase another
  // window's newer run while that purge awaits its own storage transaction.
  return guard === undefined ? cleanupFailedAcceptance(host, result) : result;
}

function superseded(guard: UntrackedAcceptanceGuard | undefined, result: Result): boolean {
  return guard !== undefined && (!guard.current() || (result.ok && !result.value));
}

async function cleanupFailedAcceptance(host: Host, failure: Result): Promise<Result> {
  const purged = await host.purge();
  if (!purged.ok) return failure;
  return { ok: true, value: true };
}
