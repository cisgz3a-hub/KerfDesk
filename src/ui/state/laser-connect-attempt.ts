export type ConnectAttemptOwnershipRefs = {
  connectAttemptRevision: number;
  forgetIntentRevision: number;
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
