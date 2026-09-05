// laser-origin-actions — Set / Reset / Release-motors store actions, extracted
// from laser-store.ts when it hit the ADR-015 size cap. Same shape as the other
// action modules (laser-job-actions, laser-setup-actions): a factory that
// receives the store's set/get plus the connection-bound safe write. Wraps the
// pure command writers in origin-actions.ts and applies the resulting state
// (workOriginActive / wcoCache / frameVerification). Type-only LaserState
// import — no runtime cycle.

import { inferCurrentMachinePosition } from './infer-machine-position';
import { useStore } from './store';
import { captureWorkZZeroEvidence, selectedCncToolId } from './work-z-zero-evidence';
import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
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
  mpgCommandBlockMessage,
  motionOperationCommandBlockMessage,
  pushLog,
} from './laser-store-helpers';
import type { LaserState } from './laser-store';
import type { LiveRefs } from './laser-store';
import { confirmFreshManualMotionIdle } from './manual-motion-fresh-idle';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = OriginSafeWrite;

// Every origin action requires a known stationary controller and exclusive
// acknowledgement ownership before it may start a transaction.
async function assertOriginActionReady(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  assertOriginActionReadyNow(set, get, refs);
  await confirmFreshManualMotionIdle({ get, refs, write: safeWrite, action: 'origin' }).catch(
    (error: unknown) =>
      blockOriginAction(set, get, error instanceof Error ? error.message : String(error)),
  );
  assertOriginActionReadyNow(set, get, refs);
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

export function originActions(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
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
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  await assertOriginActionReady(set, get, refs, safeWrite);
  let sawFreshWcoFrame = true;
  const sessionEpoch = get().controllerSessionEpoch;
  const writeEpoch = refs.writeEpoch;
  await runOriginTransaction(
    set,
    get,
    refs,
    safeWrite,
    'Set work origin',
    (write) => setOriginHereAction(write, usesPrimaryWcs(get())),
    // After the G92, a full-WCS (GRBL-family) controller reports the new work
    // offset on its next status frame, which populates wcoCache. Right after
    // Release motors ($SLP) + Wake — the no-homing hand-set workflow — the prior
    // offset is unknown, so transientXyOriginPatch honestly declines to fabricate
    // it and leaves wcoCache null. Wait for that frame so the
    // origin is usable the instant Set origin reports success. A G92 does not move
    // the head, and no homing is needed. g92-only (Smoothie) / WCS-less (Marlin)
    // controllers never report WCO, so skip the wait there.
    async (assertCurrent) => {
      if (usesPrimaryWcs(get())) {
        sawFreshWcoFrame = await waitForOriginWcoFrame(get, assertCurrent);
      }
      const { statusReport, wcoCache } = get();
      return transientXyOriginPatch(
        // wcoCache intentionally stores the controller's reported units; the
        // canonical millimetre selector is used at every consumer boundary.
        inferCurrentMachinePosition(statusReport, wcoCache),
        wcoCache,
      );
    },
    { changesXyOrigin: true, reestablishesPositionEvidence: true },
  );
  // The controller stayed silent past the wait, so the origin is recorded
  // without a fresh work offset — its machine location is unconfirmed and Start
  // will refuse it until a jog forces a WCO frame. Say so now, at Set origin
  // time, instead of only surfacing it later at Start (audit B21). Non-blocking:
  // the origin is still set; this is a heads-up, not a gate.
  if (
    !sawFreshWcoFrame &&
    get().controllerSessionEpoch === sessionEpoch &&
    refs.writeEpoch === writeEpoch
  ) {
    set((state) => ({ log: pushLog(state, ORIGIN_WCO_UNCONFIRMED_NOTICE) }));
  }
}

async function zeroZHere(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  await assertOriginActionReady(set, get, refs, safeWrite);
  await runOriginTransaction(
    set,
    get,
    refs,
    safeWrite,
    'Zero work Z',
    (write) => zeroZHereAction(write, usesPrimaryWcs(get())),
    () => ({
      workZZeroEvidence: captureWorkZZeroEvidence(
        'manual-zero',
        get().workZReferenceEpoch,
        selectedCncToolId(useStore.getState().project),
      ),
    }),
  );
}

async function resetOrigin(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  await assertOriginActionReady(set, get, refs, safeWrite);
  await runOriginTransaction(
    set,
    get,
    refs,
    safeWrite,
    'Reset transient origin',
    (write) => resetOriginAction(write, usesPrimaryWcs(get())),
    () =>
      get().workOriginSource === 'g54-persistent'
        ? persistentOriginAfterTransientClearPatch()
        : clearedOriginPatch(),
    { changesXyOrigin: true },
  );
}

async function setPersistentOriginHere(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  await assertOriginActionReady(set, get, refs, safeWrite);
  await runOriginTransaction(
    set,
    get,
    refs,
    safeWrite,
    'Set persistent origin',
    (write) => setPersistentOriginHereAction(write, usesPrimaryWcs(get())),
    persistentOriginAfterTransientClearPatch,
    { changesXyOrigin: true },
  );
}

async function clearPersistentOrigin(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  await assertOriginActionReady(set, get, refs, safeWrite);
  await runOriginTransaction(
    set,
    get,
    refs,
    safeWrite,
    'Clear persistent origin',
    (write) => clearPersistentOriginAction(write, usesPrimaryWcs(get())),
    clearedOriginPatch,
    { changesXyOrigin: true },
  );
}

async function releaseMotors(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  await assertOriginActionReady(set, get, refs, safeWrite);
  await runOriginTransaction(
    set,
    get,
    refs,
    safeWrite,
    'Release motors',
    releaseMotorsAction,
    () =>
      get().workOriginSource === 'g54-persistent'
        ? unknownOriginPatch()
        : {
            ...clearedOriginPatch(),
            positionEvidenceSuppressed: true,
            statusReport: null,
            statusObservation: null,
          },
    { changesXyOrigin: true },
  );
}

function usesPrimaryWcs(state: LaserState): boolean {
  return state.capabilities.wcs === 'g92-and-g10';
}

// Bounded so a silent controller cannot hang Set origin; a full-WCS controller
// emits the work offset on its next status after a G92, so a usable value
// normally lands within a poll cycle. On timeout it records with whatever is
// available (as before), so a silent controller is no worse off than before.
const ORIGIN_WCO_WAIT_TIMEOUT_MS = 3_000;
const ORIGIN_WCO_POLL_MS = 50;

export const ORIGIN_WCO_UNCONFIRMED_NOTICE =
  '[lf2] Origin set, but the controller has not reported a fresh work offset. Its machine ' +
  'location is unconfirmed — jog once to refresh it before Start, which will otherwise refuse ' +
  'the location-unknown origin.';

// Resolves true once a fresh work offset lands (wcoCache populated), or false if
// the controller stays silent past the deadline. The caller uses the outcome to
// warn that the recorded origin's location is unconfirmed.
async function waitForOriginWcoFrame(get: GetFn, assertCurrent: () => void): Promise<boolean> {
  const deadline = Date.now() + ORIGIN_WCO_WAIT_TIMEOUT_MS;
  assertCurrent();
  while (get().wcoCache === null && Date.now() <= deadline) {
    await sleep(ORIGIN_WCO_POLL_MS);
    assertCurrent();
  }
  return get().wcoCache !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    positionEvidenceSuppressed: false,
    wcoCache: axisHonestWco,
    frameVerification: null,
    framedRun: null,
  };
}

function persistentOriginAfterTransientClearPatch(): Partial<LaserState> {
  return {
    workOriginActive: true,
    workOriginSource: 'g54-persistent',
    positionEvidenceSuppressed: false,
    // G92.1 clears every transient axis. The boolean does not encode whether
    // Z came from G92 or persistent G54, so conservatively require a new touch-off.
    // Any Z-reference loss also voids work-Z evidence (fail-closed for CNC start).
    workZZeroEvidence: null,
    // G10 L20 P1 writes X/Y only. Z cannot be reconstructed from MPos after
    // G92.1, so wait for a fresh WCO-bearing status instead of fabricating it.
    wcoCache: null,
    frameVerification: null,
    framedRun: null,
  };
}

function clearedOriginPatch(): Partial<LaserState> {
  return {
    workOriginActive: false,
    workOriginSource: 'none',
    // clearOrigin (G92.1) drops ALL G92 offsets, Z included, so work Z0 is void.
    workZZeroEvidence: null,
    wcoCache: null,
    frameVerification: null,
    framedRun: null,
  };
}
