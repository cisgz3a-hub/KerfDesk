// start-blocker-invalidation — expiry for the retained Start/Frame refusal.
//
// The banner quotes the exact objects and settings that blocked the run, so it
// stops being true the moment the operator edits the project it described.
// Previously only a fresh Start, a Frame, or Forget Controller cleared it:
// deleting the offending artwork left the refusal on screen naming an object
// that no longer existed. Expiry is a pure host-side display concern — it
// refuses nothing and gates nothing (ADR-228).

import { createStore } from 'zustand/vanilla';
import { USER_ORIGIN_REQUIRED_MESSAGE, VERIFIED_ORIGIN_REQUIRED_MESSAGE } from '../job-placement';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { useStartBlockerStore, type BlockedAttempt } from './start-blocker-store';

type InvalidationLifecycle = { readonly owner: symbol | null };

// Subscription ownership lives in a store rather than a module-level `let`, so
// the module holds no mutable state (same pattern as framed-run-invalidation).
const invalidationLifecycle = createStore<InvalidationLifecycle>(() => ({ owner: null }));

/**
 * Retain a Start/Frame refusal for the operator to read, and arm its expiry so
 * the next project edit retires it. Prefer this over calling the store's
 * `report` directly — a refusal reported without expiry outlives its cause.
 */
export function reportStartBlockers(
  messages: ReadonlyArray<string>,
  attempt: BlockedAttempt = 'start',
): void {
  ensureStartBlockerInvalidationSubscription();
  useStartBlockerStore.getState().report(messages, attempt);
}

/** Retire the retained refusal because a fresh Start or Frame is under way. */
export function clearStartBlockers(): void {
  useStartBlockerStore.getState().clear();
}

function ensureStartBlockerInvalidationSubscription(): void {
  const owner = Symbol('start-blocker-invalidation');
  invalidationLifecycle.setState((state) => (state.owner === null ? { owner } : state));
  if (invalidationLifecycle.getState().owner !== owner) return;
  useStore.subscribe((state, previous) => {
    // Project identity, not every AppState change: selection, tool mode, and
    // panel state do not answer a refusal, and clearing on those would blank
    // the banner before the operator had read it.
    if (state.project === previous.project) return;
    if (useStartBlockerStore.getState().messages.length === 0) return;
    useStartBlockerStore.getState().clear();
  });
  // Setting the origin answers "needs a custom work origin": the banner kept
  // asking for it after Set origin here (UX audit U4-P3-6).
  useLaserStore.subscribe((state, previous) => {
    if (state.workOriginActive !== true || previous.workOriginActive === true) return;
    retireOriginRequiredBlockers();
  });
}

const ORIGIN_REQUIRED = new Set([USER_ORIGIN_REQUIRED_MESSAGE, VERIFIED_ORIGIN_REQUIRED_MESSAGE]);

function retireOriginRequiredBlockers(): void {
  const { messages, attempt, report, clear } = useStartBlockerStore.getState();
  const left = messages.filter((message) => !ORIGIN_REQUIRED.has(message));
  if (left.length === messages.length) return;
  if (left.length === 0) clear();
  else report(left, attempt);
}
