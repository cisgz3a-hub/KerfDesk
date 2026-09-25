// One App-level My machines dialog, so the machine rail and the job dock can
// both open it even while the other one is collapsed.

import { create } from 'zustand';

type MyMachinesDialogStore = {
  readonly open: boolean;
  readonly show: () => void;
  readonly hide: () => void;
};

export const useMyMachinesDialogStore = create<MyMachinesDialogStore>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

export function openMyMachines(): void {
  useMyMachinesDialogStore.getState().show();
}
