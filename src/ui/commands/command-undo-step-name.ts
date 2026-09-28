// The Undo list names a step a menu, toolbar or context-bar command made after
// that command: "Align Left", "Weld", "Paste in Place". runCommand applies it
// (undo-step-names.ts); a dialog the command opens names its own step later.

import type { AppCommand, CommandId } from './command-types';

// Commands whose change description says more than their label: Delete names
// what it removed ("Delete 3 objects"), the same as the Delete key.
const NAMED_BY_CHANGE: ReadonlySet<CommandId> = new Set<CommandId>(['edit.delete']);

export function commandUndoStepName(command: AppCommand): string | null {
  if (NAMED_BY_CHANGE.has(command.id)) return null;
  return command.label.replace(/(\.\.\.|…)$/u, '').trim();
}
