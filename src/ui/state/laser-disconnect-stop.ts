// The commands Disconnect sends before it closes the port, and, on a
// controller that got no realtime reset, a brief wait for the controller to
// acknowledge them.
//
// Closing the port drops DTR, and Smoothieware's USB serial discards whatever
// it has not yet parsed when the host detaches: USBSerial::on_main_loop()
// flushes its receive buffer on the detach before it dispatches the next
// buffered line, one line per main-loop pass (USBSerial.cpp:322-366, USBCDC.cpp
// CDC_SET_CONTROL_LINE_STATE). KerfDesk wrote `M5` and `M9` and closed the port
// in the same millisecond, so with Manual Air on an unparsed `M9` could be lost
// and the air kept running while KerfDesk showed Disconnected (audit TC-3). The
// controller answers each parsed line with `ok`, which KerfDesk already owes on
// its untracked-ack ledger, so those acknowledgements prove the cleanup
// escaped the flush.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/USBDevice/USBSerial/USBSerial.cpp#L322-L366
//
// A live job stream owns every acknowledgement and refills on it, so waiting
// then would keep feeding the job after Disconnect; that case keeps its
// immediate close and the unconfirmed-stop notice.

import { disconnectStopPlan } from './laser-disconnect-safety';
import { isGrblFamilyDriver, runGrblDisconnectTransaction } from './laser-disconnect-transaction';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState, LiveRefs } from './laser-store';
import { isActiveJob, pushLog } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

export const DISCONNECT_CLEANUP_ACK_WAIT_MS = 1_000;
const CLEANUP_ACK_POLL_MS = 10;

export async function stopBeforeDisconnect(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  connection: NonNullable<LiveRefs['connection']>,
): Promise<void> {
  if (isGrblFamilyDriver(refs.driver)) {
    await runGrblDisconnectTransaction(set, refs, safeWrite);
    return;
  }
  // Marlin's quickstop lines when anything may still run (MA-7), else the
  // ordinary stop commands (laser-disconnect-safety.ts).
  const stopCommands = disconnectStopPlan(get(), refs.driver).commands;
  const softReset = refs.driver.realtime.softReset;
  for (const stopCommand of stopCommands) {
    await safeWrite(stopCommand, 'disconnect');
  }
  // No realtime reset went out, so only the controller parsing these lines
  // stops the output: wait (bounded) for their acknowledgements before the
  // close drops DTR (audit TC-3).
  if (disconnectWaitsForCleanupAcks(get(), stopCommands, softReset)) {
    await waitForDisconnectCleanupAcks(set, get, () => refs.connection === connection);
  }
}

/** Whether Disconnect should wait for the cleanup lines it just wrote. */
export function disconnectWaitsForCleanupAcks(
  state: LaserState,
  cleanupLines: ReadonlyArray<string>,
  softReset: string | null,
): boolean {
  if (softReset !== null && cleanupLines.includes(softReset)) return false;
  if (isActiveJob(state.streamer)) return false;
  return cleanupLines.some((line) => line.endsWith('\n'));
}

/**
 * Resolves once nothing is owed, or after the bound. A bound that expires is
 * logged; the port then closes as before, and any unconfirmed-stop notice the
 * disconnect already carries stays.
 */
async function waitForDisconnectCleanupAcks(
  set: SetFn,
  get: GetFn,
  stillOwned: () => boolean,
): Promise<void> {
  const deadline = Date.now() + DISCONNECT_CLEANUP_ACK_WAIT_MS;
  while (get().pendingUntrackedAcks > 0 && stillOwned()) {
    if (Date.now() >= deadline) {
      set((state) => ({
        log: pushLog(
          state,
          `[lf2] Disconnect: the controller did not acknowledge the stop commands within ${DISCONNECT_CLEANUP_ACK_WAIT_MS / 1_000} s; closing the port anyway. Check that the laser and air are off.`,
        ),
      }));
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, CLEANUP_ACK_POLL_MS);
    });
  }
}
