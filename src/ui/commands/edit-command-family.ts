import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

export function editCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    undoCommand(ctx),
    redoCommand(ctx),
    enabled('edit.select-all', 'edit', 'Select All', 'Select all artwork', ctx.selectAll, 'Ctrl+A'),
    selectionCommand(ctx, 'edit.copy', 'Copy', 'Select an object to copy.', ctx.copySelection, 'Ctrl+C'),
    selectionCommand(ctx, 'edit.cut', 'Cut', 'Select an object to cut.', ctx.cutSelection, 'Ctrl+X'),
    pasteCommand(ctx),
    groupCommand(ctx),
    ungroupCommand(ctx),
    lockSelectionCommand(ctx),
    unlockAllCommand(ctx),
    selectionCommand(
      ctx,
      'edit.duplicate',
      'Duplicate',
      'Select an object to duplicate.',
      ctx.duplicateSelection,
      'Ctrl+D',
    ),
    selectionCommand(
      ctx,
      'edit.delete',
      'Delete',
      'Select an object to delete.',
      ctx.deleteSelection,
      'Delete',
    ),
    enabled(
      'edit.clear-selection',
      'edit',
      'Clear Selection',
      'Clear current selection',
      ctx.clearSelection,
      'Esc',
    ),
  ];
}

function lockSelectionCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canLockSelection
    ? enabled('edit.lock-selection', 'edit', 'Lock Selection', 'Lock selected artwork', ctx.lockSelection)
    : disabled(
        'edit.lock-selection',
        'edit',
        'Lock Selection',
        'Select unlocked artwork to lock.',
        ctx.lockSelection,
      );
}

function unlockAllCommand(ctx: AppCommandContext): AppCommand {
  return ctx.hasLockedObjects
    ? enabled('edit.unlock-all', 'edit', 'Unlock All', 'Unlock all artwork', ctx.unlockAllObjects)
    : disabled(
        'edit.unlock-all',
        'edit',
        'Unlock All',
        'No locked artwork in the project.',
        ctx.unlockAllObjects,
      );
}

function undoCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canUndo
    ? enabled('edit.undo', 'edit', 'Undo', 'Undo last edit', ctx.undo, 'Ctrl+Z')
    : disabled('edit.undo', 'edit', 'Undo', 'Nothing to undo.', ctx.undo, 'Ctrl+Z');
}

function redoCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canRedo
    ? enabled('edit.redo', 'edit', 'Redo', 'Redo last undone edit', ctx.redo, 'Ctrl+Shift+Z')
    : disabled('edit.redo', 'edit', 'Redo', 'Nothing to redo.', ctx.redo, 'Ctrl+Shift+Z');
}

function selectionCommand(
  ctx: AppCommandContext,
  id: 'edit.copy' | 'edit.cut' | 'edit.duplicate' | 'edit.delete',
  label: string,
  disabledReason: string,
  invoke: () => void,
  shortcut: string,
): AppCommand {
  return ctx.hasSelection
    ? enabled(id, 'edit', label, `${label} selection`, invoke, shortcut)
    : disabled(id, 'edit', label, disabledReason, invoke, shortcut);
}

function pasteCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canPaste
    ? enabled('edit.paste', 'edit', 'Paste', 'Paste copied artwork', ctx.pasteClipboard, 'Ctrl+V')
    : disabled(
        'edit.paste',
        'edit',
        'Paste',
        'Copy or cut artwork first.',
        ctx.pasteClipboard,
        'Ctrl+V',
      );
}

function groupCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canGroupSelection
    ? enabled('edit.group', 'edit', 'Group', 'Group selected artwork', ctx.groupSelection, 'Ctrl+G')
    : disabled(
        'edit.group',
        'edit',
        'Group',
        'Select at least two objects to group.',
        ctx.groupSelection,
        'Ctrl+G',
      );
}

function ungroupCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canUngroupSelection
    ? enabled(
        'edit.ungroup',
        'edit',
        'Ungroup',
        'Ungroup selected artwork',
        ctx.ungroupSelection,
        'Ctrl+Shift+G',
      )
    : disabled(
        'edit.ungroup',
        'edit',
        'Ungroup',
        'Select grouped artwork to ungroup.',
        ctx.ungroupSelection,
        'Ctrl+Shift+G',
      );
}
