// laser-origin-actions — Set / Reset / Release-motors store actions, extracted
// from laser-store.ts when it hit the ADR-015 size cap. Same shape as the other
// action modules (laser-job-actions, laser-setup-actions): a factory that
// receives the store's set/get plus the connection-bound safe write. Wraps the
// pure command writers in origin-actions.ts and applies the resulting state
// (workOriginActive / wcoCache / frameVerification). Type-only LaserState
// import — no runtime cycle.

import { inferCurrentMachinePosition } from './infer-machine-position';
import {
  clearPersistentOrigin as clearPersistentOriginAction,
  releaseMotors as releaseMotorsAction,
  resetOrigin as resetOriginAction,
  setOriginHere as setOriginHereAction,
  setPersistentOriginHere as setPersistentOriginHereAction,
  zeroZHere as zeroZHereAction,
} from './origin-actions';
import { type LaserSafetyAction } from './laser-safety-notice';
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
type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;

// All three origin actions require the same guards: autofocus idle, no active
// job, and no motion operation (frame/jog) in flight. The motion guard mutates
// state on block (so it isn't a pure predicate like the other two).
function assertOriginActionReady(set: SetFn, get: GetFn): void {
  assertAutofocusIdle(get());
  assertNoActiveJob(get());
  const blocked = motionOperationCommandBlockMessage(get());
  if (blocked === null) return;
  set({ lastWriteError: blocked, log: pushLog(get(), `[lf2] Motion command blocked: ${blocked}`) });
  throw new Error(blocked);
}

function assertPersistentOriginReady(set: SetFn, get: GetFn): void {
  assertOriginActionReady(set, get);
  const status = get().statusReport;
  if (status !== null && status.state === 'Idle') return;
  const current = status?.state ?? 'unknown';
  const blocked = `Machine must be Idle before changing persistent origin (currently ${current}).`;
  set({ lastWriteError: blocked, log: pushLog(get(), `[lf2] Origin command blocked: ${blocked}`) });
  throw new Error(blocked);
}

export function originActions(
  set: SetFn,
  get: GetFn,
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
    setOriginHere: async () => {
      assertOriginActionReady(set, get);
      await setOriginHereAction((out) => safeWrite(out, 'origin'));
      const { statusReport, wcoCache } = get();
      const inferredWco = inferCurrentMachinePosition(statusReport, wcoCache);
      set(activeOriginPatch('g92', inferredWco));
    },
    zeroZHere: async () => {
      assertOriginActionReady(set, get);
      await zeroZHereAction((out) => safeWrite(out, 'origin'));
      // Z-only offset: XY origin state is untouched, and the WCO cache
      // refreshes from the next WCO-bearing status frame. This is what
      // establishes work Z0 (the CNC stock-top contract) for the Start advisory.
      set({
        workZZeroKnown: true,
        log: pushLog(get(), '[lf2] Work Z zeroed at current bit height (G92 Z0).'),
      });
    },
    resetOrigin: async () => {
      assertOriginActionReady(set, get);
      await resetOriginAction((out) => safeWrite(out, 'origin'));
      if (get().workOriginSource === 'g54-persistent') {
        set({ frameVerification: null });
        return;
      }
      set(clearedOriginPatch());
    },
    setPersistentOriginHere: async () => {
      assertPersistentOriginReady(set, get);
      await setPersistentOriginHereAction((out) => safeWrite(out, 'origin'));
      const { statusReport, wcoCache } = get();
      const inferredWco = inferCurrentMachinePosition(statusReport, wcoCache);
      set(activeOriginPatch('g54-persistent', inferredWco));
    },
    clearPersistentOrigin: async () => {
      assertPersistentOriginReady(set, get);
      await clearPersistentOriginAction((out) => safeWrite(out, 'origin'));
      set(clearedOriginPatch());
    },
    releaseMotors: async () => {
      assertOriginActionReady(set, get);
      await releaseMotorsAction((out) => safeWrite(out, 'origin'));
      // The head is now hand-movable and waking ($SLP -> soft-reset) clears G92,
      // so transient origin and any Verified Frame are void (ADR-053 P4). G54
      // can survive, but the cached WCO is no longer trustworthy after hand move.
      if (get().workOriginSource === 'g54-persistent') {
        set(unknownOriginPatch());
        return;
      }
      set(clearedOriginPatch());
    },
  };
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

function unknownOriginPatch(): Partial<LaserState> {
  return {
    workOriginActive: true,
    workOriginSource: 'unknown',
    // Motors released / hand-moved: the bit-to-stock Z relationship is void.
    workZZeroKnown: false,
    wcoCache: null,
    frameVerification: null,
  };
}
