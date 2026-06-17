// laser-origin-actions — Set / Reset / Release-motors store actions, extracted
// from laser-store.ts when it hit the ADR-015 size cap. Same shape as the other
// action modules (laser-job-actions, laser-setup-actions): a factory that
// receives the store's set/get plus the connection-bound safe write. Wraps the
// pure command writers in origin-actions.ts and applies the resulting state
// (workOriginActive / wcoCache / frameVerification). Type-only LaserState
// import — no runtime cycle.

import { inferCurrentMachinePosition } from './infer-machine-position';
import {
  releaseMotors as releaseMotorsAction,
  resetOrigin as resetOriginAction,
  setOriginHere as setOriginHereAction,
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

export function originActions(
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
): Pick<LaserState, 'setOriginHere' | 'resetOrigin' | 'releaseMotors'> {
  return {
    setOriginHere: async () => {
      assertOriginActionReady(set, get);
      await setOriginHereAction((out) => safeWrite(out, 'origin'));
      const { statusReport, wcoCache } = get();
      const inferredWco = inferCurrentMachinePosition(statusReport, wcoCache);
      set({
        workOriginActive: true,
        // A new origin invalidates any prior Verified Frame (ADR-053 P2).
        frameVerification: null,
        ...(inferredWco !== null ? { wcoCache: inferredWco } : {}),
      });
    },
    resetOrigin: async () => {
      assertOriginActionReady(set, get);
      await resetOriginAction((out) => safeWrite(out, 'origin'));
      set({ workOriginActive: false, wcoCache: null, frameVerification: null });
    },
    releaseMotors: async () => {
      assertOriginActionReady(set, get);
      await releaseMotorsAction((out) => safeWrite(out, 'origin'));
      // The head is now hand-movable and waking ($SLP -> soft-reset) clears G92,
      // so the origin and any Verified Frame are void (ADR-053 P4).
      set({ workOriginActive: false, wcoCache: null, frameVerification: null });
    },
  };
}
