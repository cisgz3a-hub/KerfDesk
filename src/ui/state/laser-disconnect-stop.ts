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
// A live job still owes its earlier acknowledgements. Freeze refill before
// sending cleanup, preserve that reply debt, and retain the existing bounded
// write-attempt/close behavior and unconfirmed-stop notice for an active job.

import { disconnectStopPlan } from './laser-disconnect-safety';
import { isGrblFamilyDriver, runGrblDisconnectTransaction } from './laser-disconnect-transaction';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState, LiveRefs } from './laser-store';
import { isActiveJob } from './laser-store-helpers';
import { pause as pauseStreamer } from '../../core/controllers/grbl';
import { cancelControllerLifecycleRefs } from './laser-interactive-command';
import { cancelRawControllerLineWait } from './laser-connection-teardown';
import { invalidateControllerSessionEvidence } from './laser-controller-evidence';
import { frameProofReset } from './laser-session-reset';
import { provisionalResetCanvasPatch } from './laser-reset-terminal-state';
import { DISCONNECT_WRITE_TIMEOUT_MS } from './laser-reset-ownership';
import { publishControllerIncident } from './laser-incident-publish';
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
    await runGrblDisconnectTransaction(set, refs, safeWrite, { keepErroredStreamer: true });
    return;
  }
  // Marlin's quickstop lines when anything may still run (MA-7), else the
  // ordinary stop commands (laser-disconnect-safety.ts).
  const stopCommands = disconnectStopPlan(get(), refs.driver).commands;
  const softReset = refs.driver.realtime.softReset;
  freezeDisconnect(set, refs);
  let firstError: unknown = null;
  for (const stopCommand of stopCommands) {
    if (refs.connection !== connection) break;
    try {
      await writeDisconnectCommand(safeWrite, stopCommand);
    } catch (error) {
      // A blocked/rejected first write must not prevent attempting the other
      // tool-off lines or closing the unusable connection.
      firstError ??= error;
    }
  }
  if (firstError !== null) throw firstError;
  // No realtime reset went out, so only the controller parsing these lines
  // stops the output: wait (bounded) for their acknowledgements before the
  // close drops DTR (audit TC-3).
  if (disconnectWaitsForCleanupAcks(get(), stopCommands, softReset)) {
    await waitForDisconnectCleanupAcks(set, get, refs, () => refs.connection === connection);
  }
}

/** Stop host refill and pending motion before the first transport await. Keep
 * ACK debt and the nonterminal job until actual closure supplies its cause. */
function freezeDisconnect(set: SetFn, refs: LiveRefs): void {
  cancelControllerLifecycleRefs(refs, 'Controller is disconnecting.');
  refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
  cancelRawControllerLineWait(refs);
  set((state) => ({
    ...invalidateControllerSessionEvidence(state),
    ...frameProofReset(),
    ...provisionalResetCanvasPatch(state),
    streamer: state.streamer === null ? null : pauseStreamer(state.streamer),
    motionOperation: null,
    probeBusy: false,
    pauseResumeTransition: null,
    controllerOperation: { kind: 'disconnect', phase: 'stopping' },
  }));
}

function writeDisconnectCommand(safeWrite: SafeWriteFn, command: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Serial write timed out during controller disconnect.')),
      DISCONNECT_WRITE_TIMEOUT_MS,
    );
    void safeWrite(command, 'disconnect').then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
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
  refs: LiveRefs,
  stillOwned: () => boolean,
): Promise<void> {
  const deadline = Date.now() + DISCONNECT_CLEANUP_ACK_WAIT_MS;
  while (get().pendingUntrackedAcks > 0 && stillOwned()) {
    if (Date.now() >= deadline) {
      set((state) =>
        publishControllerIncident(
          refs,
          state,
          `[lf2] Disconnect: the controller did not acknowledge the stop commands within ${DISCONNECT_CLEANUP_ACK_WAIT_MS / 1_000} s; closing the port anyway. Check that the laser and air are off.`,
          'message',
        ),
      );
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, CLEANUP_ACK_POLL_MS);
    });
  }
}
