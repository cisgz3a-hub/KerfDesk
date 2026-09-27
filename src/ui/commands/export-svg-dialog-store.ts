// File > Export artwork as SVG opens a short options dialog before the save
// picker (ADR-451). Session chrome, not document state: the Group islands
// choice is remembered until the app reloads, off by default so the file is
// unchanged unless asked.

import { create } from 'zustand';

type ExportSvgDialogState = {
  readonly open: boolean;
  readonly groupIslands: boolean;
  readonly show: () => void;
  readonly close: () => void;
  readonly rememberGroupIslands: (groupIslands: boolean) => void;
};

export const useExportSvgDialogStore = create<ExportSvgDialogState>((set) => ({
  open: false,
  groupIslands: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
  rememberGroupIslands: (groupIslands) => set({ groupIslands }),
}));
