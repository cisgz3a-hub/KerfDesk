// Which barcode dialog is open (ADR-372): insert from the Tools menu or
// toolbar, or edit from the properties panel or a double-click. Kept apart
// from the project store because it is session chrome, not document state.
// The last inserted settings seed the next insert, so a run of labels keeps
// its type and size.

import { create } from 'zustand';
import type { BarcodeShape } from '../../core/barcode';

export type BarcodeDialogRequest =
  | { readonly mode: 'insert' }
  | { readonly mode: 'edit'; readonly objectId: string };

type BarcodeDialogState = {
  readonly request: BarcodeDialogRequest | null;
  readonly lastInserted: BarcodeShape | null;
  readonly open: (request: BarcodeDialogRequest) => void;
  readonly close: () => void;
  readonly rememberInserted: (spec: BarcodeShape) => void;
};

export const useBarcodeDialogStore = create<BarcodeDialogState>((set) => ({
  request: null,
  lastInserted: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
  rememberInserted: (spec) => set({ lastInserted: spec }),
}));
