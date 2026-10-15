import {
  connectAttemptIsCurrent,
  connectAttemptWasForgotten,
  type ConnectAttempt,
  type ConnectAttemptOwnershipRefs,
} from './laser-connect-attempt';

type PendingConnect = {
  readonly attempt: ConnectAttempt;
  readonly completion: Promise<void>;
};

const pendingConnects = new WeakMap<ConnectAttemptOwnershipRefs, Set<PendingConnect>>();

/** A forgotten permission lookup must finish revoking its chosen grant before
 * another attempt can select/open it. Platform wrappers do not identify grants. */
export async function runConnectAfterPermissionCleanup(
  refs: ConnectAttemptOwnershipRefs,
  attempt: ConnectAttempt,
  connect: () => Promise<void>,
): Promise<void> {
  const pending = pendingConnects.get(refs) ?? new Set<PendingConnect>();
  pendingConnects.set(refs, pending);
  // Retain superseded lookups too: Forget covers every older in-flight attempt.
  const forgottenCleanup = [...pending]
    .filter((entry) => connectAttemptWasForgotten(refs, entry.attempt))
    .map((entry) => entry.completion);
  // Register before invoking any adapter code, including synchronous callbacks.
  const completion = Promise.resolve().then(async () => {
    // A failed cleanup is terminal, not an unfinished operation to wait on forever.
    await Promise.allSettled(forgottenCleanup);
    if (connectAttemptIsCurrent(refs, attempt)) await connect();
  });
  const entry = { attempt, completion };
  pending.add(entry);
  try {
    await completion;
  } finally {
    pending.delete(entry);
    // An older completion cannot remove a newer attempt's cleanup obligations.
    if (pending.size === 0 && pendingConnects.get(refs) === pending) pendingConnects.delete(refs);
  }
}
