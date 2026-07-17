// $G modal read that seeds store.activeWcs for the placement-mismatch
// advisory (C6). Shared by the connect handshake and the post-reset settings
// re-qualification: both end with a freshly qualified controller whose modal
// state the store has never (or, after a reset banner, no longer) observed.
// A NORMAL owed-ack query — its [GC:...] reply is captured passively by the
// line handler, its terminal ok settles the untracked-ack fence like any
// other command's. Advisory-only and non-fatal — a missing capability, a
// stale epoch, or a failed write just leaves activeWcs null (no warning).

import type { ControllerDriver } from '../../core/controllers';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';

type GetFn = () => LaserState;
type WriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
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
  // Conservative: stay out of any in-flight command exchange. The owed-ack
  // accounting would be correct either way; skipping just keeps the advisory
  // read from interleaving with an operator command's reply window.
  if (state.pendingUntrackedAcks > 0) return;
  await safeWrite(`${modalQuery}\n`, undefined, 'system').catch(() => undefined);
}
