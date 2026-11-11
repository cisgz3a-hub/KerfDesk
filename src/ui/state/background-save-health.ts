// Which background saves are not protecting the work right now (annoyance
// audit A5-P2-1, ADR-305 Amendment 1).
//
// A background save that fails says so once, in a toast that leaves after
// eight seconds. An operator who looked away then worked on with no recovery
// copy and no sign of it. This store keeps the fact for as long as it is true:
// from a failed write until the next write of the same kind succeeds (or, for
// autosave, until a manual save makes the copy unnecessary). It also holds the
// milder case of an autosave that is waiting for a job to end. The status bar
// shows both; the toast still says a failure once.

import { create } from 'zustand';

export type BackgroundSaveKind = 'autosave' | 'machine-settings';

export type BackgroundSaveSign = {
  /** `failed`: the last write did not happen. `waiting`: it is being held back. */
  readonly state: 'failed' | 'waiting';
  /** The cause and what to do, as the status bar's tooltip says it. */
  readonly message: string;
};

type BackgroundSaveHealthState = {
  /** One sign per kind that is not saving; absent while that kind is healthy. */
  readonly signs: Readonly<Partial<Record<BackgroundSaveKind, BackgroundSaveSign>>>;
  readonly noteFailed: (kind: BackgroundSaveKind, message: string) => void;
  /** Sets or clears the waiting sign. A failure is the stronger fact and stays. */
  readonly noteWaiting: (kind: BackgroundSaveKind, message: string | null) => void;
  readonly noteSaved: (kind: BackgroundSaveKind) => void;
};

function without(
  signs: BackgroundSaveHealthState['signs'],
  kind: BackgroundSaveKind,
): BackgroundSaveHealthState['signs'] {
  const { [kind]: _cleared, ...rest } = signs;
  return rest;
}

// The loop reports on every tick and every good write, so each action returns
// the same state object, and notifies nobody, when it changes nothing.
export const useBackgroundSaveHealth = create<BackgroundSaveHealthState>((set) => ({
  signs: {},
  noteFailed: (kind, message) =>
    set((state) => {
      const sign = state.signs[kind];
      if (sign?.state === 'failed' && sign.message === message) return state;
      return { signs: { ...state.signs, [kind]: { state: 'failed', message } } };
    }),
  noteWaiting: (kind, message) =>
    set((state) => {
      const sign = state.signs[kind];
      if (sign?.state === 'failed') return state;
      if (message === null)
        return sign === undefined ? state : { signs: without(state.signs, kind) };
      if (sign?.message === message) return state;
      return { signs: { ...state.signs, [kind]: { state: 'waiting', message } } };
    }),
  noteSaved: (kind) =>
    set((state) =>
      state.signs[kind] === undefined ? state : { signs: without(state.signs, kind) },
    ),
}));
