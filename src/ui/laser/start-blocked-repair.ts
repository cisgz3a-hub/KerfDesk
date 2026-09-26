// Shared primitives for the in-place fix offers that Frame job makes through
// frame-blocker-repair (start-blocked-alarm-offers, start-blocked-setup-offers),
// kept here so neither offer module imports the other.

import { useLaserStore, type LaserState } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';

/** 'retry' — the blocking condition is repaired; rerun the Start flow once.
 * 'handled' — a physical operator step is underway (the frame trace); skip
 * the refusal report, the operator re-Starts when the step completes.
 * 'unrepaired' — nothing offered or the operator declined; report as before. */
export type BlockedStartRepair = 'retry' | 'handled' | 'unrepaired';

// GRBL reflects unlock/home/override effects through the next status report,
// so a bounded settle-wait covers the poll latency. Timing out is not a
// failure: the command was accepted, so hand back 'handled' with a
// press-Start-again toast instead of the refusal alert.
const REPAIR_SETTLE_TIMEOUT_MS = 4_000;
const REPAIR_SETTLE_POLL_MS = 50;

export async function settleThenRetry(
  ready: (state: LaserState) => boolean,
  settledToast: string,
  pendingToast: string,
): Promise<BlockedStartRepair> {
  const deadline = Date.now() + REPAIR_SETTLE_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    if (ready(useLaserStore.getState())) {
      useToastStore.getState().pushToast(settledToast, 'success');
      return 'retry';
    }
    await sleep(REPAIR_SETTLE_POLL_MS);
  }
  useToastStore.getState().pushToast(pendingToast, 'success');
  return 'handled';
}

export function repairFailed(action: string, cause: unknown): BlockedStartRepair {
  const reason = cause instanceof Error ? cause.message : String(cause);
  useToastStore.getState().pushToast(`${action}: ${reason}`, 'warning');
  return 'unrepaired';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
