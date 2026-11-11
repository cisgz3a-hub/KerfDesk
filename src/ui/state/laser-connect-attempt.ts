export type ConnectAttemptOwnershipRefs = {
  connectAttemptRevision: number;
  forgetIntentRevision: number;
};

/** Why a connection streams from the window (ADR-676 Amendment 5):
 *  - `opted-out`: the machine profile turned Background streaming off;
 *  - `adapter-not-unique`: the USB worker needs this adapter to be the only
 *    granted port with its vendor and product IDs, and it is not;
 *  - `worker-unavailable`: the worker was asked for and could not start;
 *  - `no-worker`: the transport offers no worker for this connection. */
export type WindowStreamReason =
  | 'opted-out'
  | 'adapter-not-unique'
  | 'worker-unavailable'
  | 'no-worker';

/** The stream-host fields a closed connection publishes. */
export const NO_JOB_STREAM_HOST = { jobStreamHost: null, windowStreamReason: null } as const;

/** The live connection's identity as the store publishes it (ADR-420). */
export type ConnectionAttemptState = {
  /** Retained after loss to prevent a network reconnect silently choosing USB.
   * Session-only routing intent; contains no target or connection authority. */
  readonly lastConnectionTransport?: 'serial' | 'tcp' | null;
  /** The baud the live connection opened at; null while disconnected. */
  readonly connectedBaudRate?: number | null;
  /** Who refills the live connection's job stream: a worker, or the app
   *  window, whose stalls can starve the controller (ADR-676). */
  readonly jobStreamHost?: 'worker' | 'window' | null;
  /** Why the window refills it, so Job Review names a route that can work
   *  (ADR-676 Amendment 5). Null with a worker or while disconnected. */
  readonly windowStreamReason?: WindowStreamReason | null;
  /** The platform the live connection runs in. A browser ('web') lets the
   *  computer sleep while its tab is hidden, which Job Review says before
   *  Start (ADR-117 Amendment 1). Null while disconnected. */
  readonly connectionHost?: 'web' | 'electron' | 'mock' | null;
  /** Revision of the latest connect attempt or intentional disconnect. The live
   *  connection belongs to whoever started the attempt with this revision; any
   *  later connect or disconnect moves it on. Undefined reads as 0. */
  readonly connectionAttempt?: number;
};

export type ConnectAttempt = {
  readonly revision: number;
  readonly forgetIntentRevision: number;
};

export function beginConnectAttempt(refs: ConnectAttemptOwnershipRefs): ConnectAttempt {
  refs.connectAttemptRevision += 1;
  return {
    revision: refs.connectAttemptRevision,
    forgetIntentRevision: refs.forgetIntentRevision,
  };
}

export function cancelConnectAttempt(
  refs: ConnectAttemptOwnershipRefs,
  forgetRequested: boolean,
): void {
  refs.connectAttemptRevision += 1;
  if (forgetRequested) refs.forgetIntentRevision += 1;
}

export function connectAttemptIsCurrent(
  refs: ConnectAttemptOwnershipRefs,
  attempt: ConnectAttempt,
): boolean {
  return refs.connectAttemptRevision === attempt.revision;
}

export function connectAttemptWasForgotten(
  refs: ConnectAttemptOwnershipRefs,
  attempt: ConnectAttempt,
): boolean {
  return refs.forgetIntentRevision !== attempt.forgetIntentRevision;
}
