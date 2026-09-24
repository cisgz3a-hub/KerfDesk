// controller-queue-settle — wait, bounded, until every earlier controller write
// has been acknowledged.
//
// A Console line resolves when its bytes reach the transport, not on the
// controller's `ok`, and the store refuses a settings read while an
// acknowledgement is still owed. A workflow that sends `$I` and then reads the
// settings must therefore wait for that ok first; Machine Setup's read-only
// checks did not, so they failed at the settings read on every GRBL, grblHAL
// and FluidNC controller (audit settings-console-3).

import { hasPendingControllerWrite } from './laser-start-queue-fence';
import { useLaserStore } from './laser-store';

const DEFAULT_SETTLE_TIMEOUT_MS = 2_000;
const SETTLE_POLL_MS = 25;

/** True once nothing is owed, false if the deadline passed first. */
export async function waitForControllerQueueSettled(
  timeoutMs: number = DEFAULT_SETTLE_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (hasPendingControllerWrite(useLaserStore.getState())) {
    if (Date.now() > deadline) return false;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, SETTLE_POLL_MS);
    });
  }
  return true;
}
