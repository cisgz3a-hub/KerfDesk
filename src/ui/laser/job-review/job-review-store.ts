// useJobReviewStore — pending-request state for the pre-start Job Review
// dialog (ADR-224). The start flow's review gate opens a request and then
// consumes operator signals one at a time (`nextSignal`); the dialog fires
// confirm / cancel / rebuild. A signal raised while the gate is busy
// re-preparing is held in `pendingSignal` (cancel outranks confirm outranks
// rebuild) so nothing is lost and rebuild bursts coalesce. Kept as its own
// store (ConfirmSave precedent) so the file keeps one responsibility.

import { create } from 'zustand';
import type { JobReviewModel } from './job-review-model';

export type JobReviewSignal = 'confirm' | 'cancel' | 'rebuild';
export type JobReviewPurpose = 'start' | 'frame';

export type JobReviewState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'open';
      readonly model: JobReviewModel;
      readonly purpose: JobReviewPurpose;
      readonly isPreparing: boolean;
      readonly blocker: ReadonlyArray<string> | null;
    };

type JobReviewStore = {
  readonly state: JobReviewState;
  /** One-shot resolver armed by the gate's `nextSignal`; null while unarmed. */
  readonly waiter: ((signal: JobReviewSignal) => void) | null;
  /** Highest-priority signal raised while unarmed, consumed by `nextSignal`. */
  readonly pendingSignal: JobReviewSignal | null;
  // Gate-facing — the start flow drives these.
  readonly open: (model: JobReviewModel, purpose?: JobReviewPurpose) => boolean;
  readonly nextSignal: () => Promise<JobReviewSignal>;
  readonly beginPrepare: () => void;
  readonly completePrepare: (model: JobReviewModel) => void;
  readonly failPrepare: (blocker: ReadonlyArray<string>) => void;
  readonly close: () => void;
  // Dialog-facing.
  readonly confirm: () => void;
  readonly cancel: () => void;
  readonly requestRebuild: () => void;
};

const SIGNAL_PRIORITY: Readonly<Record<JobReviewSignal, number>> = {
  cancel: 3,
  confirm: 2,
  rebuild: 1,
};

export const useJobReviewStore = create<JobReviewStore>((set, get) => {
  const fire = (signal: JobReviewSignal): void => {
    const { state, waiter, pendingSignal } = get();
    if (state.kind !== 'open') return;
    if (waiter !== null) {
      // Clear before resolving so a re-entrant fire (double-click) is a
      // structural no-op instead of resolving a consumed promise twice.
      set({ waiter: null });
      waiter(signal);
      return;
    }
    if (pendingSignal === null || SIGNAL_PRIORITY[signal] > SIGNAL_PRIORITY[pendingSignal]) {
      set({ pendingSignal: signal });
    }
  };
  return {
    state: { kind: 'idle' },
    waiter: null,
    pendingSignal: null,
    open: (model, purpose = 'start') => {
      // A second Start while a review is showing means an upstream gate
      // failed (the modal backdrop and shortcut suppression cover the known
      // paths). Fail the newcomer closed instead of replacing the visible
      // review (ConfirmSave precedent).
      if (get().state.kind !== 'idle') return false;
      set({
        state: { kind: 'open', model, purpose, isPreparing: false, blocker: null },
        waiter: null,
        pendingSignal: null,
      });
      return true;
    },
    nextSignal: () => {
      const pending = get().pendingSignal;
      if (pending !== null) {
        set({ pendingSignal: null });
        return Promise.resolve(pending);
      }
      return new Promise((resolve) => set({ waiter: resolve }));
    },
    beginPrepare: () => {
      const { state } = get();
      if (state.kind !== 'open') return;
      set({ state: { ...state, isPreparing: true, blocker: null } });
    },
    completePrepare: (model) => {
      const { state } = get();
      if (state.kind !== 'open') return;
      set({ state: { ...state, model, isPreparing: false, blocker: null } });
    },
    failPrepare: (blocker) => {
      // Keep the last good model on screen; the blocker banner explains why
      // Confirm is unavailable and editing further is the recovery path.
      const { state } = get();
      if (state.kind !== 'open') return;
      set({ state: { ...state, isPreparing: false, blocker } });
    },
    close: () => set({ state: { kind: 'idle' }, waiter: null, pendingSignal: null }),
    confirm: () => {
      const { state } = get();
      if (state.kind !== 'open' || state.isPreparing || state.blocker !== null) return;
      fire('confirm');
    },
    cancel: () => fire('cancel'),
    requestRebuild: () => fire('rebuild'),
  };
});
