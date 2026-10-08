import {
  continueControllerOperation,
  controllerOperationOwner,
  controllerRecoveryResetEvidence,
  recordControllerRecoveryReset,
  type LaserControllerOperation,
} from './laser-controller-operation';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import type { LaserState } from './laser-store';

// Wake may intentionally follow a canonical Abort while still awaiting Idle.
// Only its already registered, current private owner may inherit that reset.
export function canonicalRecoveryForReset(
  state: LaserState,
  refs: ControllerLifecycleRefs,
): LaserControllerOperation | null {
  const operation = state.controllerOperation;
  if (operation?.kind !== 'recovery' || refs.controllerIdleWait?.kind !== 'recovery') return null;
  const evidence = {
    sessionEpoch: state.controllerSessionEpoch + 1,
    writeEpoch: (refs.writeEpoch ?? 0) + 1,
    statusSequence: state.statusSequence,
  };
  recordControllerRecoveryReset(operation, evidence);
  if (controllerRecoveryResetEvidence(operation) !== evidence) return null;
  return continueControllerOperation(operation, {
    kind: 'recovery',
    phase: 'reset',
    idleReports: 0,
  });
}

const cleanupResults = new WeakMap<
  object,
  { readonly completion: Promise<unknown | null>; readonly abandonCanonicalRecovery: () => boolean }
>();

export function registerOwnedResetCleanup(
  operation: LaserControllerOperation,
  completion: Promise<unknown | null>,
  abandonCanonicalRecovery: () => boolean,
): void {
  cleanupResults.set(controllerOperationOwner(operation), { completion, abandonCanonicalRecovery });
}

export function ownedResetCleanupResult(
  operation: LaserControllerOperation | null,
): Promise<unknown | null> | null {
  return operation === null
    ? null
    : (cleanupResults.get(controllerOperationOwner(operation))?.completion ?? null);
}

export function abandonOwnedResetRecovery(operation: LaserControllerOperation | null): boolean {
  return operation === null
    ? false
    : (cleanupResults.get(controllerOperationOwner(operation))?.abandonCanonicalRecovery() ??
        false);
}

export function hasCoordinatedControllerReset(operation: LaserControllerOperation | null): boolean {
  return ownedResetCleanupResult(operation) !== null;
}

export function ownsResetOperation(
  state: LaserState,
  operation: LaserControllerOperation,
): boolean {
  return (
    state.controllerOperation !== null &&
    controllerOperationOwner(state.controllerOperation) === controllerOperationOwner(operation)
  );
}
