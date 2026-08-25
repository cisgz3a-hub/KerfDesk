import { create } from 'zustand';

export type SaveFilenameRequest = {
  readonly sequence: number;
  readonly suggestedName: string;
  readonly resolve: (displayName: string | null) => void;
};

type SaveFilenameState = {
  readonly queue: ReadonlyArray<SaveFilenameRequest>;
  readonly nextSequence: number;
  readonly enqueue: (request: Omit<SaveFilenameRequest, 'sequence'>) => void;
  readonly finish: (displayName: string | null) => void;
};

export const useSaveFilenameStore = create<SaveFilenameState>((set, get) => ({
  queue: [],
  nextSequence: 1,
  enqueue: (request) => {
    const sequence = get().nextSequence;
    set((state) => ({
      queue: [...state.queue, { ...request, sequence }],
      nextSequence: sequence + 1,
    }));
  },
  finish: (displayName) => {
    const pending = get().queue[0];
    if (pending === undefined) return;
    set((state) => ({ queue: state.queue.slice(1) }));
    pending.resolve(displayName);
  },
}));

export function requestSaveFilename(suggestedName: string): Promise<string | null> {
  return new Promise((resolve) => {
    useSaveFilenameStore.getState().enqueue({ suggestedName, resolve });
  });
}
