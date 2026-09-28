// Undo step names for the Undo list and the Undo History dialog (Rayforge
// comparison: "the last 15 actions by name").
//
// The undo stack holds bare project snapshots, and 160-odd actions push them,
// so the name travels beside the snapshot instead of inside the stack: a
// WeakMap keyed by the snapshot that was pushed, which is the project BEFORE
// the step. Nothing about the stack's shape, the project file or undo/redo
// changes, and a snapshot that falls off the 50-step stack takes its name with
// it (the same side-table pattern as setup-history-context.ts).
//
// A step gets its name, most specific first, from:
//   1. the push site itself — pushUndo(prev, stack, 'Trim Shapes');
//   2. the command or shortcut that ran it — withUndoStepName('Align Left', run);
//   3. what changed — describeProjectChange(before, after), e.g. "Delete 3 objects".
// So every step has a name, including ones added after this was written.

import type { Project } from '../../core/scene';
import { describeProjectChange } from './describe-project-change';

const explicitNames = new WeakMap<Project, string>();
const derivedNames = new WeakMap<Project, { readonly after: Project; readonly name: string }>();
const pendingNames: string[] = [];

/** Runs `run`, naming every undo step it pushes synchronously `name`. The
 * innermost call wins, so a store action can be more specific than the
 * command that invoked it. */
export function withUndoStepName<T>(name: string | null, run: () => T): T {
  if (name === null || name.trim() === '') return run();
  pendingNames.push(name);
  try {
    return run();
  } finally {
    pendingNames.pop();
  }
}

/** Wraps an action so each call names the undo step it pushes. */
export function namedUndoAction<Args extends ReadonlyArray<unknown>, Result>(
  name: string,
  action: (...args: Args) => Result,
): (...args: Args) => Result {
  return (...args) => withUndoStepName(name, () => action(...args));
}

/** Called by pushUndo for the snapshot it pushes. A push with no name clears
 * any name an undone-and-abandoned step left on the same snapshot, so a later
 * step starting from the same project never inherits it. */
export function recordUndoStepName(before: Project, name?: string): void {
  const resolved = name ?? pendingNames.at(-1);
  if (resolved === undefined) explicitNames.delete(before);
  else explicitNames.set(before, resolved);
}

/** The name of the step that turned `before` into `after`. */
export function undoStepName(before: Project, after: Project): string {
  const explicit = explicitNames.get(before);
  if (explicit !== undefined) return explicit;
  const cached = derivedNames.get(before);
  if (cached !== undefined && cached.after === after) return cached.name;
  const name = describeProjectChange(before, after);
  derivedNames.set(before, { after, name });
  return name;
}
