// Readiness shared by every origin action (laser-origin-actions.ts and
// laser-origin-restore.ts): a known stationary controller and exclusive
// acknowledgement ownership before an origin transaction may start.

import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import type { OriginSafeWrite } from './laser-origin-transaction';
import {
  assertAutofocusIdle,
  assertNoActiveJob,
  mpgCommandBlockMessage,
  motionOperationCommandBlockMessage,
  pushLog,
  toolChangeXyOriginBlockMessage,
} from './laser-store-helpers';
import type { LaserState, LiveRefs } from './laser-store';
import { confirmFreshManualMotionIdle } from './manual-motion-fresh-idle';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;

// Every origin action requires a known stationary controller and exclusive
// acknowledgement ownership before it may start a transaction. `axes` names
// what the action can move. Only a Z-only action (Zero Z) runs in a CNC
// tool-change hold; every other origin action can move the X/Y origin the rest
// of the job is placed on, so it is refused there (ADR-375 Amendment 3).
export async function assertOriginActionReady(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: OriginSafeWrite,
  axes: 'z' | 'xy' = 'xy',
): Promise<void> {
  const assertReady = (): void => {
    assertOriginActionReadyNow(set, get, refs);
    if (axes === 'xy') assertNoToolChangeHold(set, get);
  };
  assertReady();
  await confirmFreshManualMotionIdle({ get, refs, write: safeWrite, action: 'origin' }).catch(
    (error: unknown) =>
      blockOriginAction(set, get, error instanceof Error ? error.message : String(error)),
  );
  assertReady();
}

function assertNoToolChangeHold(set: SetFn, get: GetFn): void {
  const message = toolChangeXyOriginBlockMessage(get());
  if (message !== null) blockOriginAction(set, get, message);
}

function assertOriginActionReadyNow(set: SetFn, get: GetFn, refs: LiveRefs): void {
  assertAutofocusIdle(get());
  assertNoActiveJob(get());
  const state = get();
  const operationBlock =
    motionOperationCommandBlockMessage(state) ??
    controllerOperationCommandBlockMessage(state.controllerOperation);
  if (operationBlock !== null) blockOriginAction(set, get, operationBlock);
  const mpgBlock = mpgCommandBlockMessage(state);
  if (mpgBlock !== null) blockOriginAction(set, get, mpgBlock);
  if (state.pendingUntrackedAcks > 0 || refs.controllerCommand !== null) {
    blockOriginAction(
      set,
      get,
      'Wait for the previous controller command to be acknowledged before changing origin.',
    );
  }
  if (refs.controllerIdleWait !== null) {
    blockOriginAction(
      set,
      get,
      'Wait for the active controller Idle check before changing origin.',
    );
  }
  if (state.connection.kind !== 'connected') {
    blockOriginAction(set, get, 'Connect to the controller before changing origin.');
  }
  if (state.statusReport?.state !== 'Idle') {
    const current = state.statusReport?.state ?? 'unknown';
    blockOriginAction(
      set,
      get,
      `Machine must be Idle before changing origin (currently ${current}).`,
    );
  }
}

function blockOriginAction(set: SetFn, get: GetFn, message: string): never {
  set({
    lastWriteError: message,
    log: pushLog(get(), `[lf2] Origin command blocked: ${message}`),
  });
  throw new Error(message);
}

/** GRBL-family controllers get `G54` in the same block as the origin write. */
export function usesPrimaryWcs(state: LaserState): boolean {
  return state.capabilities.wcs === 'g92-and-g10';
}
