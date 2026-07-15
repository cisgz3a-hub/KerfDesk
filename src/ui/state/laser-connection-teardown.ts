import { idleCollector } from '../../core/controllers/grbl';
import type { SerialConnection } from '../../platform/types';
import { cancelControllerLifecycleRefs } from './laser-interactive-command';
import { cancelScheduledControllerQualification } from './laser-controller-qualification';
import { cancelResetCleanup } from './laser-reset-cleanup';
import type { LiveRefs } from './laser-store';

type CloseRequest = {
  forget: boolean;
  promise: Promise<void> | null;
};

const closeRequests = new WeakMap<SerialConnection, CloseRequest>();
const intentionalDisconnects = new WeakSet<SerialConnection>();

/** Claim final state ownership for the first explicit Disconnect on a port. */
export function claimIntentionalDisconnect(connection: SerialConnection): boolean {
  if (intentionalDisconnects.has(connection)) return false;
  intentionalDisconnects.add(connection);
  return true;
}

export function isIntentionalDisconnectClaimed(connection: SerialConnection): boolean {
  return intentionalDisconnects.has(connection);
}

/** Join every closer for one port, while allowing a concurrent Forget to win. */
export function closeConnectionOnce(
  connection: SerialConnection,
  forgetDevice = false,
): Promise<void> {
  let request = closeRequests.get(connection);
  if (request === undefined) {
    request = { forget: forgetDevice, promise: null };
    closeRequests.set(connection, request);
  } else if (forgetDevice) {
    request.forget = true;
  }
  if (request.promise !== null) return request.promise;
  request.promise = Promise.resolve().then(async () => {
    if (request?.forget === true && connection.forget !== undefined) {
      await connection.forget();
      return;
    }
    try {
      await connection.close();
    } finally {
      // A concurrent Forget can upgrade the request while close() is pending.
      // Re-check after closing so browser permission is still revoked exactly once.
      if (request?.forget === true && connection.forget !== undefined) {
        await connection.forget();
      }
    }
  });
  return request.promise;
}

/** True once any concurrent closer has upgraded this port close to Forget. */
export function connectionForgetRequested(connection: SerialConnection): boolean {
  return closeRequests.get(connection)?.forget === true;
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
