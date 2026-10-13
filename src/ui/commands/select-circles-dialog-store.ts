// Whether the Select Circles dialog is open. Session chrome, like the Optimize
// Shapes dialog, so it stays out of the project store.

import { create } from 'zustand';

type SelectCirclesDialogState = {
  readonly open: boolean;
  readonly show: () => void;
  readonly close: () => void;
};

export const useSelectCirclesDialogStore = create<SelectCirclesDialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

export function openSelectCirclesDialog(): void {
  useSelectCirclesDialogStore.getState().show();
}
