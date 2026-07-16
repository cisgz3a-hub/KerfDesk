// Ackless $G modal read that seeds store.activeWcs for the placement-mismatch
// advisory (C6). Shared by the connect handshake and the post-reset settings
// re-qualification: both end with a freshly qualified controller whose modal
// state the store has never (or, after a reset banner, no longer) observed.
// Advisory-only and non-fatal — a missing capability, a stale epoch, or a
// failed write just leaves activeWcs null (no warning).

import type { ControllerDriver } from '../../core/controllers';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';

type GetFn = () => LaserState;
type WriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
  options?: { readonly ackless?: boolean },
) => Promise<void>;

export async function requestActiveWcsReadback(
  get: GetFn,
  driver: Pick<ControllerDriver, 'commands'>,
  safeWrite: WriteFn,
  expectedSessionEpoch: number,
): Promise<void> {
  const modalQuery = driver.commands.modalStateQuery;
  if (modalQuery === null) return;
  const state = get();
  if (state.controllerSessionEpoch !== expectedSessionEpoch) return;
  if (
    state.controllerQualification.kind !== 'qualified' ||
    state.controllerQualification.epoch !== expectedSessionEpoch
  ) {
    return;
  }
  // The ackless $G leaves its ok unaccounted, so it must only settle against a
  // quiescent ledger: if any other command's terminal ack were outstanding, the
  // $G ok would settle THAT ack instead (F1). Post-qualification the ledger is
  // empty; skip the read rather than risk a mis-settle if it is not.
  if (state.pendingUntrackedAcks > 0) return;
  await safeWrite(`${modalQuery}\n`, undefined, 'system', { ackless: true }).catch(() => undefined);
}
