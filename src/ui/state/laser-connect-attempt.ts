export type ConnectAttemptOwnershipRefs = {
  connectAttemptRevision: number;
  forgetIntentRevision: number;
};

/** The live connection's identity as the store publishes it (ADR-420). */
export type ConnectionAttemptState = {
  /** The baud the live connection opened at; null while disconnected. */
  readonly connectedBaudRate?: number | null;
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
