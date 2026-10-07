// One commanded reset owner per port, shared by Abort, stall containment and
// teardown. Retained ports require causal response ownership before refresh.

import type { ControllerDriver } from '../../core/controllers';
import type { ControllerKind } from '../../core/devices';
import { waitForControllerResetBoundary } from './laser-interactive-command';
import { RESET_CLEANUP_BANNER_TIMEOUT_MS } from './laser-reset-cleanup';
import {
  armOwnedResetCleanup,
  acceptOwnedResetWrite,
  claimResetOwnership,
  failOwnedResetInformation,
  RESET_OWNERSHIP_UNCONFIRMED,
  writeResetWithinDeadline,
  type ResetOwnership,
  type ResetSetFn,
  type ResetWriteFn,
  type ResetTransactionRefs,
} from './laser-reset-ownership';
import type { LaserSafetyAction } from './laser-safety-notice';

export { DISCONNECT_WRITE_TIMEOUT_MS } from './laser-reset-ownership';

type ResetTransaction = {
  readonly result: Promise<void>;
  readonly resetWriteResult: Promise<void>;
  readonly finishResetWrite: (error: unknown | null) => void;
  closeRequested: boolean;
  owner: ResetOwnership | null;
};
type ResetTransactionOptions = {
  readonly retainConnection?: boolean;
  readonly awaitResetWriteOnly?: boolean;
  readonly action?: LaserSafetyAction;
  readonly cleanupLines?: ReadonlyArray<string>;
  readonly keepErroredStreamer?: boolean;
};
const transactions = new WeakMap<object, ResetTransaction>();
const GRBL_FAMILY_KINDS: ReadonlyArray<ControllerKind> = ['grbl-v1.1', 'grblhal', 'fluidnc'];

export function isGrblFamilyDriver(driver: ControllerDriver): boolean {
  return GRBL_FAMILY_KINDS.includes(driver.kind);
}

export function runGrblDisconnectTransaction(
  set: ResetSetFn,
  refs: ResetTransactionRefs,
  safeWrite: ResetWriteFn,
  options: ResetTransactionOptions = {},
): Promise<void> {
  const connection = refs.connection;
  if (connection === null) return Promise.resolve();
  // Narrow line-handler harnesses omit the physical port and supply a writer;
  // production uses the captured live connection as its shared owner key.
  const connectionKey = typeof connection === 'object' && connection !== null ? connection : refs;
  const existing = transactions.get(connectionKey);
  if (existing !== undefined) {
    if (!options.retainConnection) return finishForDisconnect(existing, safeWrite);
    return options.awaitResetWriteOnly ? existing.resetWriteResult : existing.result;
  }
  const transaction = createResetTransaction(connectionKey, set, refs, safeWrite, options);
  return options.awaitResetWriteOnly ? transaction.resetWriteResult : transaction.result;
}

function createResetTransaction(
  connectionKey: object,
  set: ResetSetFn,
  refs: ResetTransactionRefs,
  safeWrite: ResetWriteFn,
  options: ResetTransactionOptions,
): ResetTransaction {
  let resolveTransaction!: () => void;
  let rejectTransaction!: (error: unknown) => void;
  const result = new Promise<void>((resolve, reject) => {
    resolveTransaction = resolve;
    rejectTransaction = reject;
  });
  let finishResetWrite!: (error: unknown | null) => void;
  const resetWriteResult = new Promise<void>((resolve, reject) => {
    finishResetWrite = (error) => {
      if (error === null) resolve();
      else reject(error instanceof Error ? error : new Error(String(error)));
    };
  });
  // Abort awaits only reset transport acceptance; later cleanup still has
  // an owner and can fail independently of the action's returned promise.
  void resetWriteResult.catch(() => undefined);
  void result.catch(() => undefined);
  const transaction: ResetTransaction = {
    result,
    resetWriteResult,
    finishResetWrite,
    closeRequested: !options.retainConnection,
    owner: null,
  };
  transactions.set(connectionKey, transaction);
  void runOwnedReset(connectionKey, transaction, set, refs, safeWrite, options).then(
    resolveTransaction,
    rejectTransaction,
  );
  return transaction;
}

async function finishForDisconnect(
  transaction: ResetTransaction,
  safeWrite: ResetWriteFn,
): Promise<void> {
  transaction.closeRequested = true;
  // Closing intentionally supersedes the old action attempt on this same port.
  // Do not keep its obsolete connectionAttempt guard around off cleanup.
  if (transaction.owner !== null) transaction.owner.cleanupWrite = safeWrite;
  await transaction.result;
  const error = await transaction.owner?.finishCleanup();
  if (error != null) throw error;
}

async function runOwnedReset(
  connectionKey: object,
  transaction: ResetTransaction,
  set: ResetSetFn,
  refs: ResetTransactionRefs,
  safeWrite: ResetWriteFn,
  options: ResetTransactionOptions,
): Promise<void> {
  const reset = refs.driver.realtime.softReset;
  const connection = refs.connection;
  if (reset === null) {
    transaction.finishResetWrite(null);
    transactions.delete(connectionKey);
    return;
  }
  // Automatic transport faults quarantine and close the session. Intentional
  // Disconnect and every retained-port reset preserve its errored debt ledger.
  const owner = claimResetOwnership(connection, set, refs, resetMustQuarantineStreamer(options));
  transaction.owner = owner;
  const release = (): void => {
    const remove = (): void => {
      if (transactions.get(connectionKey) === transaction) transactions.delete(connectionKey);
    };
    if (transaction.closeRequested) void transaction.result.then(remove, remove);
    else remove();
  };
  armOwnedResetCleanup(
    owner,
    safeWrite,
    options.cleanupLines ?? ['M5', 'M9'],
    () => transaction.closeRequested,
    release,
    () => transaction.finishResetWrite(null),
  );
  const boundary = waitForOwnedResetBoundary(refs, owner);
  let resetError: unknown = null;
  try {
    await writeResetWithinDeadline(
      connection,
      refs,
      safeWrite,
      reset,
      options.action ?? 'disconnect',
    );
    owner.resetAccepted = true;
  } catch (error) {
    resetError = error;
  }
  acceptOwnedResetWrite(owner, options.keepErroredStreamer === true);
  transaction.finishResetWrite(owner.boundaryObserved ? null : resetError);
  await boundary;
  if (refs.connection !== connection) return;
  if (retainedResetHasAmbiguousResponses(owner, transaction)) {
    failOwnedResetInformation(owner, RESET_OWNERSHIP_UNCONFIRMED);
    const cleanupError = await owner.attemptUnconfirmedCleanup();
    if (cleanupError !== null) throw cleanupError;
    return;
  }
  const cleanupError = await owner.finishCleanup();
  const error = cleanupError ?? (owner.boundaryObserved ? null : resetError);
  if (error !== null) throw error;
}

function resetMustQuarantineStreamer(options: ResetTransactionOptions): boolean {
  return !options.retainConnection && !options.keepErroredStreamer;
}

function waitForOwnedResetBoundary(
  refs: ResetTransactionRefs,
  owner: ResetOwnership,
): Promise<void> {
  const deadline = Date.now() + RESET_CLEANUP_BANNER_TIMEOUT_MS;
  return waitForControllerResetBoundary(
    refs,
    owner.writeEpoch,
    RESET_CLEANUP_BANNER_TIMEOUT_MS,
  ).then(
    () => {
      owner.boundaryObserved = true;
    },
    async () => {
      // Cancelling an old lifecycle owner is not a reboot. Never let its
      // rejection shorten the window before no-greeting cleanup is attempted.
      const remaining = deadline - Date.now();
      if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
    },
  );
}

function retainedResetHasAmbiguousResponses(
  owner: ResetOwnership,
  transaction: ResetTransaction,
): boolean {
  return (
    !owner.boundaryObserved &&
    !transaction.closeRequested &&
    (owner.oldResponseDebt || !owner.resetAccepted)
  );
}
