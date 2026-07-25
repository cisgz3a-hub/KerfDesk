// start-blocker-invalidation — expiry for the retained Start/Frame refusal.
//
// The banner quotes the exact objects and settings that blocked the run, so it
// stops being true the moment the operator edits the project it described.
// Previously only a fresh Start, a Frame, or Forget Controller cleared it:
// deleting the offending artwork left the refusal on screen naming an object
// that no longer existed. Expiry is a pure host-side display concern — it
// refuses nothing and gates nothing (ADR-228).

import { createStore } from 'zustand/vanilla';
import { useStore } from '../state/store';
import { useStartBlockerStore } from './start-blocker-store';

type InvalidationLifecycle = { readonly owner: symbol | null };

// Subscription ownership lives in a store rather than a module-level `let`, so
// the module holds no mutable state (same pattern as framed-run-invalidation).
const invalidationLifecycle = createStore<InvalidationLifecycle>(() => ({ owner: null }));

/**
 * Retain a Start/Frame refusal for the operator to read, and arm its expiry so
 * the next project edit retires it. Prefer this over calling the store's
 * `report` directly — a refusal reported without expiry outlives its cause.
 */
export function reportStartBlockers(messages: ReadonlyArray<string>): void {
  ensureStartBlockerInvalidationSubscription();
  useStartBlockerStore.getState().report(messages);
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
}
