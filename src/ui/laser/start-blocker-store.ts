import { create } from 'zustand';

/** Which operator action the retained refusal answered. Frame job and Start
 * are separate buttons, so the notice names the one that was refused. */
export type BlockedAction = 'start' | 'frame';

type StartBlockerState = {
  readonly messages: ReadonlyArray<string>;
  readonly action: BlockedAction;
  readonly report: (messages: ReadonlyArray<string>, action?: BlockedAction) => void;
  readonly clear: () => void;
};

// Retains the most recent Start or Frame refusal so the operator does not have
// to remember or dismiss a modal before correcting the blocking condition.
export const useStartBlockerStore = create<StartBlockerState>((set) => ({
  messages: [],
  action: 'start',
  report: (messages, action = 'start') => set({ messages: [...messages], action }),
  clear: () => set({ messages: [] }),
}));
