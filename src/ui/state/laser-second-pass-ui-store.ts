import { create } from 'zustand';

export type SecondPassEditorRequest = {
  readonly runId: string;
  readonly returnFocusTo: HTMLElement | null;
};

type SecondPassUiState = {
  readonly completionRunId: string | null;
  readonly lastOfferedRunId: string | null;
  readonly editorRequest: SecondPassEditorRequest | null;
  readonly offerCompletion: (runId: string) => void;
  readonly dismissCompletion: (runId: string) => void;
  readonly openEditor: (runId: string, returnFocusTo?: HTMLElement | null) => void;
  readonly closeEditor: (request: SecondPassEditorRequest) => void;
};

/** Session-only UI requests. Hydrating a saved receipt never offers a new
 * completion, and dismissing the prompt never changes recovery or its archive. */
export const useLaserSecondPassUiStore = create<SecondPassUiState>((set) => ({
  completionRunId: null,
  lastOfferedRunId: null,
  editorRequest: null,
  offerCompletion: (runId) =>
    set((state) =>
      state.lastOfferedRunId === runId
        ? state
        : { completionRunId: runId, lastOfferedRunId: runId },
    ),
  dismissCompletion: (runId) =>
    set((state) => (state.completionRunId === runId ? { completionRunId: null } : state)),
  openEditor: (runId, returnFocusTo = document.activeElement as HTMLElement | null) =>
    set({ editorRequest: { runId, returnFocusTo }, completionRunId: null }),
  closeEditor: (request) =>
    set((state) => (state.editorRequest === request ? { editorRequest: null } : state)),
}));
