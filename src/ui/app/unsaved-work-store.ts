// Whether File > Recover unsaved work is open (ADR-686).

import { create } from 'zustand';

type UnsavedWorkState = {
  readonly open: boolean;
  readonly openDialog: () => void;
  readonly closeDialog: () => void;
};

export const useUnsavedWorkStore = create<UnsavedWorkState>((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
}));
