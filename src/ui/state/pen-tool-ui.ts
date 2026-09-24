// pen-tool-ui — the pen tool's hover target and node mode (ADR-380). UI-only
// like penDraft: never persisted, never undoable, and back to idle whenever
// the tool changes, so S mode never leaks into the next drawing session.

import { samePenHover, type PenHover, type PenNodeMode } from '../workspace/pen-draft';

export type PenToolUiState = {
  // Where a press would land and what it would do; drives the snap marker.
  readonly penHover: PenHover | null;
  readonly setPenHover: (next: PenHover | null) => void;
  readonly penNodeMode: PenNodeMode;
  readonly togglePenNodeMode: () => void;
};

export const PEN_TOOL_IDLE = {
  penHover: null,
  penNodeMode: 'corner',
} as const satisfies Partial<PenToolUiState>;

type PenToolUiSetter = (
  partial: Partial<PenToolUiState> | ((state: PenToolUiState) => Partial<PenToolUiState>),
) => void;

export function penToolUiSlice(set: PenToolUiSetter): PenToolUiState {
  return {
    ...PEN_TOOL_IDLE,
    // Pointer moves that land on the same target return the state itself,
    // which the store treats as no change, so a snapped hover does not
    // repaint the canvas for every pixel the pointer moves.
    setPenHover: (next) =>
      set((state) => (samePenHover(state.penHover, next) ? state : { penHover: next })),
    togglePenNodeMode: () =>
      set((state) => ({ penNodeMode: state.penNodeMode === 'corner' ? 'smooth' : 'corner' })),
  };
}
