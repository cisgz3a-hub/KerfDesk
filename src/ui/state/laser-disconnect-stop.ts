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
import { hostedRefillArmed, releaseHostedRefill } from './laser-hosted-refill';
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
import { positioningLightDisconnectOff } from './positioning-light-actions';

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
  // A light KerfDesk switched on over this connection is switched off with the
  // other cleanup lines, best effort: it never blocks or fails Disconnect.
  const lightOff = positioningLightDisconnectOff(get(), refs);
  if (isGrblFamilyDriver(refs.driver)) {
    await runGrblDisconnectTransaction(set, refs, safeWrite, {
      keepErroredStreamer: true,
      ...(lightOff === null ? {} : { cleanupLines: ['M5', 'M9', lightOff] }),
    });
    return;
  }
  await stopWithoutResetBeforeDisconnect(set, get, refs, safeWrite, connection, lightOff);
}

async function stopWithoutResetBeforeDisconnect(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  connection: NonNullable<LiveRefs['connection']>,
  lightOff: string | null,
): Promise<void> {
  // Marlin's quickstop lines when anything may still run (MA-7), else the
  // ordinary stop commands (laser-disconnect-safety.ts).
  const stopCommands = disconnectStopPlan(get(), refs.driver).commands;
  const softReset = refs.driver.realtime.softReset;
  const firstError = hostedRefillArmed(refs)
    ? await stopWithHostedRefillHandback(set, refs, safeWrite, stopCommands, connection)
    : await freezeAndWriteInOrder(set, refs, safeWrite, stopCommands, connection);
  if (firstError !== null) throw firstError;
  const lightLines = lightOff === null ? [] : [`${lightOff}\n`];
  for (const line of lightLines) {
    if (refs.connection !== connection) break;
    await writeDisconnectCommand(safeWrite, line).catch(() => undefined);
  }
  // No realtime reset went out, so only the controller parsing these lines
  // stops the output: wait (bounded) for their acknowledgements before the
  // close drops DTR (audit TC-3).
  if (disconnectWaitsForCleanupAcks(get(), [...stopCommands, ...lightLines], softReset)) {
    await waitForDisconnectCleanupAcks(set, get, refs, () => refs.connection === connection);
  }
}

/** With no worker refill, the freeze runs before anything yields. Returns the
 * first write error, or null. */
async function freezeAndWriteInOrder(
  set: SetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  stopCommands: ReadonlyArray<string>,
  connection: NonNullable<LiveRefs['connection']>,
): Promise<unknown> {
  retireOwnedWrites(refs);
  freezeDisconnectState(set);
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
  return firstError;
}

// A worker-held Marlin refill (ADR-676) comes back before the freeze, so the
// worker cannot send a line this side's frozen ledger does not hold. The stop
// lines do not wait for that handshake: its reply queues behind every line the
// worker forwarded while this thread was busy, and meanwhile the controller
// can drain and stop with the beam lit (rolling audit v8 N1-P2-1). The release
// is posted first, so the worker stops refilling before the stop lines reach
// it, and every stop line is posted before the first await. Their write
// replies queue behind the same backlog, so the write bound starts once this
// thread has caught up. A connection replaced meanwhile keeps its own state;
// every later step here checks it.
async function stopWithHostedRefillHandback(
  set: SetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  stopCommands: ReadonlyArray<string>,
  connection: NonNullable<LiveRefs['connection']>,
): Promise<unknown> {
  retireOwnedWrites(refs);
  const released = releaseHostedRefill(refs);
  const written = Promise.allSettled(
    stopCommands.map((stopCommand) => safeWrite(stopCommand, 'disconnect')),
  );
  await released;
  if (refs.connection !== connection) return null;
  freezeDisconnectState(set);
  return boundedDisconnectWrite(written).then(firstRejection, (error: unknown) => error);
}

function firstRejection(results: ReadonlyArray<PromiseSettledResult<void>>): unknown {
  for (const result of results) if (result.status === 'rejected') return result.reason as unknown;
  return null;
}

/** Nothing written or awaited before Disconnect completes after it; the stop
 * lines belong to the epoch this opens. */
function retireOwnedWrites(refs: LiveRefs): void {
  cancelControllerLifecycleRefs(refs, 'Controller is disconnecting.');
  refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
  cancelRawControllerLineWait(refs);
}

/** Stop pending motion before the first transport await. Keep ACK debt and the
 * nonterminal job until actual closure supplies its cause. */
function freezeDisconnectState(set: SetFn): void {
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
  return boundedDisconnectWrite(safeWrite(command, 'disconnect'));
}

function boundedDisconnectWrite<T>(pending: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Serial write timed out during controller disconnect.')),
      DISCONNECT_WRITE_TIMEOUT_MS,
    );
    void pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
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
