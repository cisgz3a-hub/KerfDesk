// Commanded GRBL-family teardown. Ctrl-X is the fail-dark action; the reboot
// boundary separates the abandoned command/stream session from M5/M9 cleanup.

import type { ControllerDriver } from '../../core/controllers';
import type { ControllerKind } from '../../core/devices';
import type { SerialConnection } from '../../platform/types';
import { cancel as cancelStreamer, wipeInFlight } from '../../core/controllers/grbl';
import { invalidateControllerSessionEvidence } from './laser-controller-evidence';
import { cancelRawControllerLineWait } from './laser-connection-teardown';
import {
  cancelControllerLifecycleRefs,
  waitForControllerResetBoundary,
} from './laser-interactive-command';
import { cancelResetCleanup, RESET_CLEANUP_BANNER_TIMEOUT_MS } from './laser-reset-cleanup';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState, LiveRefs } from './laser-store';
import type { TranscriptSource } from './laser-transcript';
import { liveCanvasLifecyclePatch } from './live-canvas-run';

type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;
type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;

const GRBL_FAMILY_KINDS: ReadonlyArray<ControllerKind> = ['grbl-v1.1', 'grblhal', 'fluidnc'];
export const DISCONNECT_WRITE_TIMEOUT_MS = 500;

// Heartbeat containment, Disconnect, Forget, and connection replacement can
// all converge on the same live port. They must join one reset transaction:
// starting a second one would cancel the first one's banner wait and allow its
// M5/M9 cleanup to race ahead of the reboot boundary.
const transactions = new WeakMap<SerialConnection, Promise<void>>();

export function isGrblFamilyDriver(driver: ControllerDriver): boolean {
  return GRBL_FAMILY_KINDS.includes(driver.kind);
}

export function runGrblDisconnectTransaction(
  set: SetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  const connection = refs.connection;
  if (connection === null) return Promise.resolve();
  const existing = transactions.get(connection);
  if (existing !== undefined) return existing;
  let resolveTransaction!: () => void;
  let rejectTransaction!: (error: unknown) => void;
  const transaction = new Promise<void>((resolve, reject) => {
    resolveTransaction = resolve;
    rejectTransaction = reject;
  });
  transactions.set(connection, transaction);
  void runOwnedDisconnectTransaction(connection, set, refs, safeWrite).then(
    resolveTransaction,
    rejectTransaction,
  );
  const release = (): void => {
    if (transactions.get(connection) === transaction) transactions.delete(connection);
  };
  void transaction.then(release, release);
  return transaction;
}

async function runOwnedDisconnectTransaction(
  connection: SerialConnection,
  set: SetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  const reset = refs.driver.realtime.softReset;
  if (reset === null) return;
  cancelResetCleanup(refs);
  cancelControllerLifecycleRefs(refs, 'Controller abort requested before disconnect.');
  // The startup handshake has one raw line waiter outside the controller
  // command arbiter. Advance the epoch, then actively resolve that waiter so
  // neither its timer nor its continuation can send `$$` into this session.
  refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
  cancelRawControllerLineWait(refs);
  const transactionEpoch = refs.writeEpoch;
  set((state) => ({
    ...invalidateControllerSessionEvidence(state),
    streamer: state.streamer === null ? null : wipeInFlight(cancelStreamer(state.streamer)),
    ...liveCanvasLifecyclePatch(state, 'stopped'),
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    controllerOperation: { kind: 'recovery', phase: 'reset', idleReports: 0 },
  }));
  const boundary = waitForControllerResetBoundary(
    refs,
    transactionEpoch,
    RESET_CLEANUP_BANNER_TIMEOUT_MS,
  ).then(
    () => true,
    () => false,
  );
  let resetError: unknown = null;
  try {
    await writeWithinDeadline(connection, refs, safeWrite, reset, 'disconnect', 'system');
  } catch (error) {
    resetError = error;
  }
  const boundaryObserved = await boundary;
  let firstError = boundaryObserved ? null : resetError;
  for (const line of ['M5', 'M9']) {
    try {
      await writeWithinDeadline(connection, refs, safeWrite, `${line}\n`, 'disconnect', 'system');
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== null) throw firstError;
}

async function writeWithinDeadline(
  connection: SerialConnection,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  line: string,
  action: LaserSafetyAction,
  source: TranscriptSource,
): Promise<void> {
  if (refs.connection !== connection) {
    throw new Error('Serial connection changed during controller disconnect.');
  }
  const write = safeWrite(line, action, source);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === undefined) resolve();
      else reject(error instanceof Error ? error : new Error(String(error)));
    };
    const timer = setTimeout(() => {
      finish(new Error('Serial write timed out during controller disconnect.'));
    }, DISCONNECT_WRITE_TIMEOUT_MS);
    void write.then(
      () => finish(),
      (error: unknown) => finish(error),
    );
  });
}
