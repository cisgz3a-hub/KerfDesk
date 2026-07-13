// laser-origin-actions — Set / Reset / Release-motors store actions, extracted
// from laser-store.ts when it hit the ADR-015 size cap. Same shape as the other
// action modules (laser-job-actions, laser-setup-actions): a factory that
// receives the store's set/get plus the connection-bound safe write. Wraps the
// pure command writers in origin-actions.ts and applies the resulting state
// (workOriginActive / wcoCache / frameVerification). Type-only LaserState
// import — no runtime cycle.

import { inferCurrentMachinePosition } from './infer-machine-position';
import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import { type ControllerLifecycleRefs } from './laser-interactive-command';
import {
  runOriginTransaction,
  unknownOriginPatch,
  type OriginSafeWrite,
} from './laser-origin-transaction';
import {
  clearPersistentOrigin as clearPersistentOriginAction,
  releaseMotors as releaseMotorsAction,
  resetOrigin as resetOriginAction,
  setOriginHere as setOriginHereAction,
  setPersistentOriginHere as setPersistentOriginHereAction,
  zeroZHere as zeroZHereAction,
} from './origin-actions';
import {
  assertAutofocusIdle,
  assertNoActiveJob,
  motionOperationCommandBlockMessage,
  pushLog,
} from './laser-store-helpers';
import type { LaserState } from './laser-store';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = OriginSafeWrite;

// Every origin action requires a known stationary controller and exclusive
// acknowledgement ownership before it may start a transaction.
function assertOriginActionReady(set: SetFn, get: GetFn, refs: ControllerLifecycleRefs): void {
  assertAutofocusIdle(get());
  assertNoActiveJob(get());
  const state = get();
  const operationBlock =
    motionOperationCommandBlockMessage(state) ??
    controllerOperationCommandBlockMessage(state.controllerOperation);
  if (operationBlock !== null) blockOriginAction(set, get, operationBlock);
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

export function originActions(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
): Pick<
  LaserState,
  | 'setOriginHere'
  | 'zeroZHere'
  | 'resetOrigin'
  | 'setPersistentOriginHere'
  | 'clearPersistentOrigin'
  | 'releaseMotors'
> {
  return {
    setOriginHere: () => setOriginHere(set, get, refs, safeWrite),
    zeroZHere: () => zeroZHere(set, get, refs, safeWrite),
    resetOrigin: () => resetOrigin(set, get, refs, safeWrite),
    setPersistentOriginHere: () => setPersistentOriginHere(set, get, refs, safeWrite),
    clearPersistentOrigin: () => clearPersistentOrigin(set, get, refs, safeWrite),
    releaseMotors: () => releaseMotors(set, get, refs, safeWrite),
  };
}

async function setOriginHere(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  assertOriginActionReady(set, get, refs);
  await runOriginTransaction(
    set,
    refs,
    safeWrite,
    'Set work origin',
    (write) => setOriginHereAction(write, usesPrimaryWcs(get())),
    () => {
      const { statusReport, wcoCache } = get();
      return transientXyOriginPatch(inferCurrentMachinePosition(statusReport, wcoCache), wcoCache);
    },
  );
}

async function zeroZHere(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  assertOriginActionReady(set, get, refs);
  await runOriginTransaction(
    set,
    refs,
    safeWrite,
    'Zero work Z',
    (write) => zeroZHereAction(write, usesPrimaryWcs(get())),
    () => ({ workZZeroKnown: true }),
  );
}

async function resetOrigin(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  assertOriginActionReady(set, get, refs);
  await runOriginTransaction(
    set,
    refs,
    safeWrite,
    'Reset transient origin',
    (write) => resetOriginAction(write, usesPrimaryWcs(get())),
    () =>
      get().workOriginSource === 'g54-persistent'
        ? persistentOriginAfterTransientClearPatch()
        : clearedOriginPatch(),
  );
}

async function setPersistentOriginHere(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  assertOriginActionReady(set, get, refs);
  await runOriginTransaction(
    set,
    refs,
    safeWrite,
    'Set persistent origin',
    (write) => setPersistentOriginHereAction(write, usesPrimaryWcs(get())),
    persistentOriginAfterTransientClearPatch,
  );
}

async function clearPersistentOrigin(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  assertOriginActionReady(set, get, refs);
  await runOriginTransaction(
    set,
    refs,
    safeWrite,
    'Clear persistent origin',
    (write) => clearPersistentOriginAction(write, usesPrimaryWcs(get())),
    clearedOriginPatch,
  );
}

async function releaseMotors(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  assertOriginActionReady(set, get, refs);
  await runOriginTransaction(set, refs, safeWrite, 'Release motors', releaseMotorsAction, () =>
    get().workOriginSource === 'g54-persistent' ? unknownOriginPatch() : clearedOriginPatch(),
  );
}

function usesPrimaryWcs(state: LaserState): boolean {
  return state.capabilities.wcs === 'g92-and-g10';
}

function transientXyOriginPatch(
  inferredMachinePosition: LaserState['wcoCache'],
  priorWco: LaserState['wcoCache'],
): Partial<LaserState> {
  const axisHonestWco =
    inferredMachinePosition === null || priorWco === null
      ? null
      : {
          x: inferredMachinePosition.x,
          y: inferredMachinePosition.y,
          z: priorWco.z,
        };
  return {
    workOriginActive: true,
    workOriginSource: 'g92',
    wcoCache: axisHonestWco,
    frameVerification: null,
  };
}

function persistentOriginAfterTransientClearPatch(): Partial<LaserState> {
  return {
    workOriginActive: true,
    workOriginSource: 'g54-persistent',
    // G92.1 clears every transient axis. The boolean does not encode whether
    // Z came from G92 or persistent G54, so conservatively require a new touch-off.
    workZZeroKnown: false,
    // G10 L20 P1 writes X/Y only. Z cannot be reconstructed from MPos after
    // G92.1, so wait for a fresh WCO-bearing status instead of fabricating it.
    wcoCache: null,
    frameVerification: null,
  };
}

function clearedOriginPatch(): Partial<LaserState> {
  return {
    workOriginActive: false,
    workOriginSource: 'none',
    // clearOrigin (G92.1) drops ALL G92 offsets, Z included, so work Z0 is void.
    workZZeroKnown: false,
    wcoCache: null,
    frameVerification: null,
  };
}
