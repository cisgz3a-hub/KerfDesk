import { create } from 'zustand';

export const useAiDialogStore = create<{
  readonly open: boolean;
  readonly show: () => void;
  readonly close: () => void;
}>((set) => ({ open: false, show: () => set({ open: true }), close: () => set({ open: false }) }));
