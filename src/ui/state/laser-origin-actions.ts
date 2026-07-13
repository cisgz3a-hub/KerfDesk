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
  await runOriginTransaction(set, refs, safeWrite, 'Set work origin', setOriginHereAction, () => {
    const { statusReport, wcoCache } = get();
    return activeOriginPatch('g92', inferCurrentMachinePosition(statusReport, wcoCache));
  });
}

async function zeroZHere(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  assertOriginActionReady(set, get, refs);
  await runOriginTransaction(set, refs, safeWrite, 'Zero work Z', zeroZHereAction, () => ({
    workZZeroKnown: true,
  }));
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
    resetOriginAction,
    () =>
      get().workOriginSource === 'g54-persistent'
        ? { frameVerification: null }
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
    setPersistentOriginHereAction,
    () => {
      const { statusReport, wcoCache } = get();
      return activeOriginPatch(
        'g54-persistent',
        inferCurrentMachinePosition(statusReport, wcoCache),
      );
    },
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
    clearPersistentOriginAction,
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

function activeOriginPatch(
  workOriginSource: 'g92' | 'g54-persistent',
  inferredWco: LaserState['wcoCache'],
): Partial<LaserState> {
  return {
    workOriginActive: true,
    workOriginSource,
    frameVerification: null,
    ...(inferredWco !== null ? { wcoCache: inferredWco } : {}),
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
