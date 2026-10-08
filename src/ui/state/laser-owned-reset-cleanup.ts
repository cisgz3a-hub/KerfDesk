import { armResetCleanup, flushResetCleanup } from './laser-reset-cleanup';
import { ownsResetOperation, registerOwnedResetCleanup } from './laser-owned-reset-recovery';
import {
  resetCleanupWritesPending,
  trackedResetCleanupWriter,
} from './laser-reset-write-ownership';
import {
  failOwnedResetInformation,
  RESET_OWNERSHIP_UNCONFIRMED,
  writeResetWithinDeadline,
  type ResetOwnership,
  type ResetWriteFn,
} from './laser-reset-ownership';
import type { LaserSafetyAction } from './laser-safety-notice';

type CleanupContext = {
  readonly lines: ReadonlyArray<string>;
  readonly closeRequested: () => boolean;
  readonly release: () => void;
  readonly onResetBoundary: () => void;
  readonly finishProof: (error: unknown | null) => void;
};

export function armOwnedResetCleanup(
  owner: ResetOwnership,
  safeWrite: ResetWriteFn,
  lines: ReadonlyArray<string>,
  closeRequested: () => boolean,
  release: () => void,
  onResetBoundary: () => void,
): void {
  let finishProof!: (error: unknown | null) => void;
  const proof = new Promise<unknown | null>((resolve) => {
    finishProof = resolve;
  });
  registerOwnedResetCleanup(owner.operation, proof, () => {
    owner.canonicalWake = false;
    // Relinquish only the completion lease here. Wake publishes its failure
    // and any resolved owner release together, before subscribers can reopen
    // controls and start another operation.
    return owner.cleanupComplete;
  });
  owner.cleanupWrite = safeWrite;
  const context: CleanupContext = { lines, closeRequested, release, onResetBoundary, finishProof };
  bindUnconfirmedCleanup(owner, context);
  armCausalResetCleanup(owner, context);
}

function armCausalResetCleanup(owner: ResetOwnership, context: CleanupContext): void {
  let finishDelivery!: (error: unknown | null) => void;
  const delivery = new Promise<unknown | null>((resolve) => {
    finishDelivery = resolve;
  });
  let firstWriteError: unknown = null;
  const write = async (line: string, action?: LaserSafetyAction): Promise<void> => {
    try {
      await writeResetWithinDeadline(
        owner.connection,
        owner.refs,
        trackedResetCleanupWriter(owner),
        line,
        action ?? 'stop',
      );
    } catch (error) {
      // Always try coolant-off too. Transport acceptance proves no beam-off.
      firstWriteError ??= error;
    }
  };
  armResetCleanup(owner.refs, write, context.lines, {
    requireResetBoundary: true,
    onResetBoundary: () => {
      owner.boundaryObserved = true;
      owner.cleanupBoundaryUncertain = resetCleanupWritesPending(owner);
      // A boot proves the reset byte, but cannot erase an off write that is
      // still crossing the transport. Settle Abort before controls can reopen.
      context.onResetBoundary();
    },
    onComplete: (error) => {
      const failure = error ?? firstWriteError;
      finishDelivery(failure);
      finishCausalResetCleanup(owner, context, failure);
    },
    onCancel: () => {
      const error = new Error('Controller reset cleanup was cancelled.');
      finishDelivery(error);
      context.finishProof(error);
      context.release();
    },
  });
  const ownedCleanup = owner.refs.pendingResetCleanup;
  owner.finishCleanup = () => {
    if (!owner.boundaryObserved && owner.unconfirmedCleanup !== null)
      return owner.unconfirmedCleanup;
    if (
      owner.refs.connection === owner.connection &&
      owner.refs.pendingResetCleanup === ownedCleanup
    )
      flushResetCleanup(owner.refs, write);
    return delivery;
  };
}

function finishCausalResetCleanup(
  owner: ResetOwnership,
  context: CleanupContext,
  error: unknown | null,
): void {
  if (error === null && owner.cleanupBoundaryUncertain && !context.closeRequested()) {
    failOwnedResetInformation(owner, RESET_OWNERSHIP_UNCONFIRMED);
    // Retain the private owner until a later boot occurs with no ordinary off
    // write crossing it. Anonymous replies cannot substitute for that boundary.
    armCausalResetCleanup(owner, context);
    return;
  }
  context.finishProof(error);
  completeOwnedResetCleanup(owner, error, context.closeRequested(), context.release);
}

function bindUnconfirmedCleanup(owner: ResetOwnership, context: CleanupContext): void {
  owner.attemptUnconfirmedCleanup = () => {
    owner.unconfirmedCleanup ??= attemptUnconfirmedCleanup(owner, context.lines).then((error) => {
      if (error !== null) {
        context.finishProof(error);
        completeOwnedResetCleanup(owner, error, context.closeRequested(), context.release);
      }
      return error;
    });
    return owner.unconfirmedCleanup;
  };
}

async function attemptUnconfirmedCleanup(
  owner: ResetOwnership,
  lines: ReadonlyArray<string>,
): Promise<unknown | null> {
  let firstError: unknown = null;
  for (const line of lines) {
    // A late boot belongs to the separately armed causal cleanup. Its new
    // epoch fences any pre-boundary transport promise still completing.
    if (owner.boundaryObserved || owner.refs.connection !== owner.connection) break;
    try {
      await writeResetWithinDeadline(
        owner.connection,
        owner.refs,
        trackedResetCleanupWriter(owner),
        line + '\n',
        'stop',
      );
    } catch (error) {
      firstError ??= error;
    }
  }
  return owner.boundaryObserved ? null : firstError;
}

function completeOwnedResetCleanup(
  owner: ResetOwnership,
  error: unknown | null,
  closeRequested: boolean,
  release: () => void,
): void {
  if (error !== null) {
    owner.canonicalWake = false;
    failOwnedResetInformation(
      owner,
      'Beam-off cleanup could not be sent after the controller reset. Reconnect to recover controller information.',
    );
    // Keep the failed state fence, but release a completed transaction so a
    // later explicit Abort attempts a fresh reset rather than joining failure.
    release();
    return;
  }
  const resolved = owner.boundaryObserved || (!owner.oldResponseDebt && owner.resetAccepted);
  owner.cleanupComplete = resolved;
  if (
    !closeRequested &&
    !owner.canonicalWake &&
    resolved &&
    owner.refs.connection === owner.connection
  ) {
    owner.set((state) =>
      ownsResetOperation(state, owner.operation) ? { controllerOperation: null } : {},
    );
  }
  release();
}
