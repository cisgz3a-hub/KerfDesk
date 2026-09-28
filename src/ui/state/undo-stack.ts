// The undo stack's push and depth cap. Moved out of scene-mutations.ts, which
// re-exports both, so the 160-odd actions that import them from there are
// unchanged.

import type { Project } from '../../core/scene';
import { recordUndoStepName } from './undo-step-names';

// Shared undo/redo stack ceiling. store-actions caps the redo stack against the
// same value, so it lives beside pushUndo rather than being redeclared —
// keeping the two ceilings from silently desyncing.
export const HISTORY_DEPTH = 50;

// Push the previous project onto undoStack with a depth cap. `name` labels the
// step in the Undo list; without one the step takes the name of the command
// that ran it, or of what it changed (undo-step-names.ts).
export function pushUndo(
  prev: Project,
  stack: ReadonlyArray<Project>,
  name?: string,
): ReadonlyArray<Project> {
  recordUndoStepName(prev, name);
  return [...stack, prev].slice(-HISTORY_DEPTH);
}
