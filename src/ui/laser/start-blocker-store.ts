import { create } from 'zustand';

type StartBlockerState = {
  readonly messages: ReadonlyArray<string>;
  readonly report: (messages: ReadonlyArray<string>) => void;
  readonly clear: () => void;
};

// Retains the most recent Start refusal so the operator does not have to
// remember or dismiss a modal before correcting the blocking condition.
export const useStartBlockerStore = create<StartBlockerState>((set) => ({
  messages: [],
  report: (messages) => set({ messages: [...messages] }),
  clear: () => set({ messages: [] }),
}));
