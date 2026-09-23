// Arm the durable Start handoff from the cheap intent (ADR-337).
//
// Unavailable recovery storage is NOT a Start gate: rule 7 refuses only when
// transport cannot accept work, output cannot be produced or streamed, or the
// reviewed artifact cannot be handed off consistently. A run whose durable
// record could not be written still goes to the machine, and
// `activateAcceptedFreshRun` tells the operator afterwards that it has no
// forensic record — the same posture staging had before this decision.
//
// One record owns the handoff at a time. Pressing Start again right after a
// job ends used to meet the previous run's record while its terminal was still
// being saved and was refused as "Another job Start is already being
// prepared". Start now waits briefly for that record to close, then names what
// actually holds the handoff if it still does (ADR-341 Amendment 3).

import type { RecoveryRepository, RecoveryRepositorySnapshot, RunId } from '../state/recovery';
import { createStartIntent } from '../state/recovery/start-intent';
import { reportStartBlockers } from './start-blocker-invalidation';
import type { PreparedStartArgs } from './start-job-transmission';

/** Longest wait for an earlier run's record to close; a terminal write takes
 * milliseconds, a Start handoff lease five seconds. */
export const START_HANDOFF_SETTLE_WAIT_MS = 2_000;
const START_HANDOFF_SETTLE_POLL_MS = 25;

export async function armFreshStartHandoff(
  args: PreparedStartArgs,
  runId: RunId,
): Promise<{ readonly armed: boolean; readonly blocked: boolean }> {
  const intent = createStartIntent({
    gcode: args.prepared.gcode,
    machineKind: args.machineKind,
    outputScope: args.outputScope,
    ...(args.prepared.jobOrigin === undefined ? {} : { jobOrigin: args.prepared.jobOrigin }),
    nowIso: new Date().toISOString(),
  });
  let armed = await args.repository.armFreshStartIntent(runId, intent);
  if (armed.ok && !armed.value && (await earlierRecordClosed(args.repository))) {
    armed = await args.repository.armFreshStartIntent(runId, intent);
  }
  if (armed.ok && armed.value) return { armed: true, blocked: false };
  await args.repository.cancelPendingStart(runId);
  if (!armed.ok) return { armed: false, blocked: false };
  reportStartBlockers([startHandoffBlockedMessage(args.repository.getSnapshot())]);
  return { armed: false, blocked: true };
}

/** Wait until neither an active run nor another pending Start holds the
 * handoff; false when one still does after the settle wait. */
async function earlierRecordClosed(repository: RecoveryRepository): Promise<boolean> {
  const deadline = Date.now() + START_HANDOFF_SETTLE_WAIT_MS;
  for (;;) {
    const refreshed = await repository.refresh();
    const snapshot = refreshed.ok ? refreshed.value : repository.getSnapshot();
    if (snapshot.activeRun === null && snapshot.pendingStart === null) return true;
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, START_HANDOFF_SETTLE_POLL_MS));
  }
}

export function startHandoffBlockedMessage(snapshot: RecoveryRepositorySnapshot): string {
  if (snapshot.pendingStart !== null) {
    return 'Another job Start is still being handed to the controller, possibly in another KerfDesk window. Wait for it to finish, then press Start again.';
  }
  return 'The previous job is still recorded as running, possibly in another KerfDesk window. Wait for it to finish or stop it there, then press Start again.';
}
