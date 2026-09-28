// The named undo and redo history the Undo list and the Undo History dialog
// show, and the multi-step jump they perform.
//
// A jump is the ordinary Undo (or Redo) run N times, not a new restore path:
// each step goes onto the other stack in order, so Redo walks forward again one
// step at a time, and every per-step rule in historyActions (setup context,
// probe epoch, selection) applies exactly as it does for Ctrl+Z.

import type { Project } from '../../core/scene';
import { useStore } from './store';
import { undoStepName } from './undo-step-names';

/** How many steps the Undo list shows (Rayforge shows 15). */
export const UNDO_LIST_LENGTH = 15;

export type UndoHistoryEntry = {
  readonly name: string;
  /** Undos (or redos) that take the project to just before (or just after) this step. */
  readonly steps: number;
};

type HistoryState = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
};

/** Steps that can be undone, newest first. */
export function undoHistoryEntries(
  state: HistoryState,
  limit = Number.POSITIVE_INFINITY,
): ReadonlyArray<UndoHistoryEntry> {
  const { undoStack, project } = state;
  const entries: UndoHistoryEntry[] = [];
  for (let index = undoStack.length - 1; index >= 0 && entries.length < limit; index -= 1) {
    const before = undoStack[index];
    if (before === undefined) break;
    const after = undoStack[index + 1] ?? project;
    entries.push({ name: undoStepName(before, after), steps: entries.length + 1 });
  }
  return entries;
}

/** Steps that can be redone, the next one first. */
export function redoHistoryEntries(
  state: HistoryState,
  limit = Number.POSITIVE_INFINITY,
): ReadonlyArray<UndoHistoryEntry> {
  const { redoStack, project } = state;
  const entries: UndoHistoryEntry[] = [];
  for (let index = redoStack.length - 1; index >= 0 && entries.length < limit; index -= 1) {
    const after = redoStack[index];
    if (after === undefined) break;
    const before = redoStack[index + 1] ?? project;
    entries.push({ name: undoStepName(before, after), steps: entries.length + 1 });
  }
  return entries;
}

/** Undo `count` steps: back to just before the step `count` places down the list. */
export function undoSteps(count: number): void {
  for (let step = 0; step < count; step += 1) {
    const state = useStore.getState();
    if (state.undoStack.length === 0) return;
    state.undo();
  }
}

/** Redo `count` steps. */
export function redoSteps(count: number): void {
  for (let step = 0; step < count; step += 1) {
    const state = useStore.getState();
    if (state.redoStack.length === 0) return;
    state.redo();
  }
}
