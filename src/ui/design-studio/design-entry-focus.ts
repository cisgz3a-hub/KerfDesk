// design-entry-focus — "the operator started typing a number on the canvas"
// (ADR-272 Amendment 5, DS-3c).
//
// AutoCAD's dynamic input and Fusion's sketch entry both let a draw gesture be
// typed into without first clicking a box: the first digit opens the box and
// lands in it. The keymap lives on the overlay root and the boxes live in the
// options bar, so this tiny store carries the keystroke across. The nonce makes
// the same digit typed twice in a row two requests, not one.

import { create } from 'zustand';

export type EntrySeed = { readonly text: string; readonly nonce: number };

type EntryFocusState = {
  readonly seed: EntrySeed | null;
  readonly requestEntryFocus: (text: string) => void;
};

export const useDesignEntryFocus = create<EntryFocusState>((set) => ({
  seed: null,
  requestEntryFocus: (text) =>
    set((state) => ({ seed: { text, nonce: (state.seed?.nonce ?? 0) + 1 } })),
}));

const SEED_KEY = /^[0-9.-]$/;

/** True for a key that begins a typed number: a digit, a decimal point, or a minus sign. */
export function isEntrySeedKey(key: string): boolean {
  return SEED_KEY.test(key);
}
