import { idleCollector } from '../../core/controllers/grbl';
import type { SerialConnection } from '../../platform/types';
import { cancelControllerLifecycleRefs } from './laser-interactive-command';
import { cancelScheduledControllerQualification } from './laser-controller-qualification';
import { cancelResetCleanup } from './laser-reset-cleanup';
import type { LiveRefs } from './laser-store';

type CloseRequest = {
  forgetRequested: boolean;
  closePromise: Promise<void> | null;
  forgetPromise: Promise<void> | null;
};

export type IntentionalDisconnectRequest = {
  forgetRequested: boolean;
  operation: Promise<void> | null;
};

export type ConnectionTeardownOwnershipRefs = {
  readonly closeRequests: WeakMap<SerialConnection, CloseRequest>;
  readonly intentionalDisconnects: WeakMap<SerialConnection, IntentionalDisconnectRequest>;
};

/** Own the complete stop + close + state-finalization transaction for one port.
 * Later Disconnect callers only join; Forget callers additionally upgrade the
 * shared close intent without entering the stop transaction themselves. */
export function runIntentionalDisconnectOnce(
  refs: ConnectionTeardownOwnershipRefs,
  connection: SerialConnection,
  forgetDevice: boolean,
  owner: (request: IntentionalDisconnectRequest) => Promise<void>,
  finalizeJoinedForget?: () => Promise<void>,
): Promise<void> {
  let request = refs.intentionalDisconnects.get(connection);
  if (request === undefined) {
    request = { forgetRequested: forgetDevice, operation: null };
    refs.intentionalDisconnects.set(connection, request);
  } else if (forgetDevice) {
    request.forgetRequested = true;
  }
  if (forgetDevice) requestConnectionForget(refs, connection);
  let operation: Promise<void>;
  if (request.operation === null) {
    request.operation = Promise.resolve().then(() => owner(request));
    operation = request.operation;
  } else {
    operation = forgetDevice
      ? joinIntentionalDisconnectAndForget(refs, connection, request.operation)
      : request.operation;
  }
  return forgetDevice && finalizeJoinedForget !== undefined
    ? finalizeForgetAfterOperation(operation, finalizeJoinedForget)
    : operation;
}

export function isIntentionalDisconnectClaimed(
  refs: ConnectionTeardownOwnershipRefs,
  connection: SerialConnection,
): boolean {
  return refs.intentionalDisconnects.has(connection);
}

/** Join every closer for one port, while allowing a concurrent Forget to win. */
export function closeConnectionOnce(
  refs: ConnectionTeardownOwnershipRefs,
  connection: SerialConnection,
  forgetDevice = false,
): Promise<void> {
  const request = closeRequestFor(refs, connection);
  if (forgetDevice) request.forgetRequested = true;
  request.closePromise ??= Promise.resolve().then(async () => {
    if (request.forgetRequested && connection.forget !== undefined) {
      await forgetConnectionOnce(request, connection);
      return;
    }
    await connection.close();
  });
  // This continuation is intentional even when closePromise has already
  // settled: a late Forget still has to revoke permission, exactly once.
  return request.closePromise.then(
    () => (request.forgetRequested ? forgetConnectionOnce(request, connection) : undefined),
    async (closeError: unknown) => {
      if (request.forgetRequested) await forgetConnectionOnce(request, connection);
      throw closeError;
    },
  );
}

/** True once any concurrent closer has upgraded this port close to Forget. */
export function connectionForgetRequested(
  refs: ConnectionTeardownOwnershipRefs,
  connection: SerialConnection,
): boolean {
  return closeRequestFor(refs, connection).forgetRequested;
}

function closeRequestFor(
  refs: ConnectionTeardownOwnershipRefs,
  connection: SerialConnection,
): CloseRequest {
  const existing = refs.closeRequests.get(connection);
  if (existing !== undefined) return existing;
  const request: CloseRequest = {
    forgetRequested: false,
    closePromise: null,
    forgetPromise: null,
  };
  refs.closeRequests.set(connection, request);
  return request;
}

function requestConnectionForget(
  refs: ConnectionTeardownOwnershipRefs,
  connection: SerialConnection,
): void {
  closeRequestFor(refs, connection).forgetRequested = true;
}

function forgetConnectionOnce(request: CloseRequest, connection: SerialConnection): Promise<void> {
  if (connection.forget === undefined) return Promise.resolve();
  request.forgetPromise ??= connection.forget();
  return request.forgetPromise;
}

async function joinIntentionalDisconnectAndForget(
  refs: ConnectionTeardownOwnershipRefs,
  connection: SerialConnection,
  operation: Promise<void>,
): Promise<void> {
  let operationError: unknown = null;
  try {
    await operation;
  } catch (error) {
    operationError = error;
  }
  await closeConnectionOnce(refs, connection, true);
  if (operationError !== null) throw operationError;
}

async function finalizeForgetAfterOperation(
  operation: Promise<void>,
  finalize: () => Promise<void>,
): Promise<void> {
  let operationError: unknown = null;
  try {
    await operation;
  } catch (error) {
    operationError = error;
  }
  await finalize();
  if (operationError !== null) throw operationError;
}

/** Resolve the startup raw-line wait without letting it qualify as a real line. */
export function cancelRawControllerLineWait(refs: LiveRefs): void {
  const pending = refs.onLineArrived;
  refs.onLineArrived = null;
  pending?.();
}

/** Invalidate and release every host-side owner of the current serial session. */
export function teardownConnectionRefs(refs: LiveRefs): void {
  refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
  cancelRawControllerLineWait(refs);
  cancelControllerLifecycleRefs(refs);
  cancelResetCleanup(refs);
  cancelScheduledControllerQualification(refs);
  refs.unsubscribeLine?.();
  refs.unsubscribeClose?.();
  if (refs.pollHandle !== null) clearInterval(refs.pollHandle);
  refs.connection = null;
  refs.unsubscribeLine = null;
  refs.unsubscribeClose = null;
  refs.pollHandle = null;
  refs.settingsCollector = idleCollector();
  refs.settingsCollectorSessionEpoch = null;
  refs.nextTranscriptId = 1;
  refs.stallProbe = null;
  refs.heartbeatProbe = null;
  refs.controllerCommand = null;
  refs.controllerIdleWait = null;
  refs.controllerResetWait = null;
  refs.controllerStatusWait = null;
}
