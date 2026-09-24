import { create } from 'zustand';

/** The button whose attempt was refused. Frame job and Start are separate
 * buttons, and Start never runs a Frame, so the notice names the one pressed. */
export type BlockedAttempt = 'start' | 'frame';

type StartBlockerState = {
  readonly messages: ReadonlyArray<string>;
  readonly attempt: BlockedAttempt;
  readonly report: (messages: ReadonlyArray<string>, attempt?: BlockedAttempt) => void;
  readonly clear: () => void;
};

// Retains the most recent Start or Frame refusal so the operator does not have
// to remember or dismiss a modal before correcting the blocking condition.
export const useStartBlockerStore = create<StartBlockerState>((set) => ({
  messages: [],
  attempt: 'start',
  report: (messages, attempt = 'start') => set({ messages: [...messages], attempt }),
  clear: () => set({ messages: [] }),
}));
