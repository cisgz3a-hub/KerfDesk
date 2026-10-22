import { create } from 'zustand';

/** An output that finished preparing after its click's picker activation
 * lapsed, waiting for a fresh Choose file… click (ADR-656). */
export type SaveReadyDialogRequest = {
  readonly title: string;
  readonly message: string;
  readonly phase: 'ready' | 'choosing';
  readonly cancel: () => void;
  readonly choose: () => void;
};

type SaveReadyDialogState = {
  readonly request: SaveReadyDialogRequest | null;
  readonly show: (request: SaveReadyDialogRequest) => void;
  readonly close: (request: SaveReadyDialogRequest) => void;
};

export const useSaveReadyDialogStore = create<SaveReadyDialogState>((set, get) => ({
  request: null,
  show: (request) => {
    const previous = get().request;
    if (previous !== null && previous.cancel !== request.cancel) previous.cancel();
    set({ request });
  },
  close: (request) => {
    if (get().request?.cancel === request.cancel) set({ request: null });
  },
}));
