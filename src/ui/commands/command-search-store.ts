// Open state of the command search (Ctrl+K). A store rather than CommandShell
// state so the window-level key handler, Help → Find a command… and the
// menu-bar search button all open the same window.

import { create } from 'zustand';

type CommandSearchState = {
  readonly open: boolean;
  readonly openCommandSearch: () => void;
  readonly closeCommandSearch: () => void;
};

export const useCommandSearchStore = create<CommandSearchState>((set) => ({
  open: false,
  openCommandSearch: () => set({ open: true }),
  closeCommandSearch: () => set({ open: false }),
}));

export function openCommandSearch(): void {
  useCommandSearchStore.getState().openCommandSearch();
}
