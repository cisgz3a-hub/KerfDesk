// Holds the pending Save / Don't Save / Cancel request for the
// confirm-save dialog (LU18, AUDIT-2026-06-10 / WORKFLOW F-A13).
//
// confirmDiscardAsync opens a request carrying a `resolve` callback and
// awaits it; ConfirmSaveDialog renders whenever a request is pending and
// funnels the user's pick back through `choose`. Kept as its own store
// (not a ui-store slice) so the file keeps a one-sentence responsibility;
// shortcut suppression comes from the dialog registering modalDepth like
// every other modal.

import { create } from 'zustand';

export type ConfirmSaveChoice = 'save' | 'discard' | 'cancel';

export type ConfirmSaveRequest = {
  // Display name for "Save changes to <name>?" — savedName or a fallback.
  readonly projectName: string;
  // What proceeding would do, phrased as a verb clause ("start a new
  // project"), interpolated into the dialog body.
  readonly action: string;
  readonly resolve: (choice: ConfirmSaveChoice) => void;
};

type ConfirmSaveState = {
  readonly request: ConfirmSaveRequest | null;
  readonly open: (request: ConfirmSaveRequest) => void;
  readonly choose: (choice: ConfirmSaveChoice) => void;
};

export const useConfirmSaveStore = create<ConfirmSaveState>((set, get) => ({
  request: null,
  open: (request) => {
    // A second request while one is showing means a gate upstream failed
    // (modal suppression covers the known paths). Fail the newcomer
    // closed instead of silently replacing the visible dialog.
    if (get().request !== null) {
      request.resolve('cancel');
      return;
    }
    set({ request });
  },
  choose: (choice) => {
    const pending = get().request;
    set({ request: null });
    pending?.resolve(choice);
  },
}));
