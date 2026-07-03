// Shortcut reference data — single source for the toolbar hover hint and the
// Keyboard Shortcuts dialog.
//
// Keep in sync with shortcuts.ts, use-job-shortcuts.ts, and drag-state.ts —
// the audit (M27/A.5) caught the old hint omitting four shipped shortcuts.
// The job-control family is machine-aware (ADR-101 §7): same keys, right noun.

import type { MachineKind } from '../../core/scene';
import { machineDisplayName } from '../machine/machine-labels';

export type ShortcutRow = {
  readonly keys: string;
  readonly action: string;
};

export type ShortcutFamily = {
  readonly family: string;
  readonly rows: ReadonlyArray<ShortcutRow>;
};

export function shortcutFamilies(machineKind: MachineKind): ReadonlyArray<ShortcutFamily> {
  return [
    {
      family: 'File',
      rows: [
        { keys: 'Ctrl+N', action: 'new' },
        { keys: 'Ctrl+O', action: 'open' },
        { keys: 'Ctrl+S', action: 'save' },
        { keys: 'Ctrl+Shift+S', action: 'save as' },
        { keys: 'Ctrl+I', action: 'import' },
        { keys: 'Ctrl+Shift+E', action: 'export G-code' },
      ],
    },
    {
      family: 'Tools',
      rows: [
        { keys: 'Ctrl+R', action: 'rectangle' },
        { keys: 'Ctrl+E', action: 'ellipse' },
        { keys: 'Ctrl+L', action: 'pen' },
        { keys: 'Alt+M', action: 'measure' },
        { keys: 'Enter or double-click', action: 'finish pen' },
        { keys: 'Esc', action: 'cancel' },
      ],
    },
    {
      family: 'Edit',
      rows: [
        { keys: 'Ctrl+Z', action: 'undo' },
        { keys: 'Ctrl+Shift+Z', action: 'redo' },
        { keys: 'Ctrl+A', action: 'select all' },
        { keys: 'Ctrl+D', action: 'duplicate' },
        { keys: 'Delete/Backspace', action: 'remove' },
        { keys: 'Escape', action: 'deselect' },
      ],
    },
    {
      family: 'Transform',
      rows: [
        { keys: 'arrows', action: 'nudge 1mm' },
        { keys: 'Shift+arrows', action: '10mm' },
        { keys: 'H', action: 'flip horizontal' },
        { keys: 'V', action: 'flip vertical' },
      ],
    },
    {
      family: 'View',
      rows: [
        { keys: 'F or 0', action: 'fit-to-bed' },
        { keys: 'Shift+F', action: 'fit-to-selection' },
        { keys: '+/-', action: 'zoom' },
        { keys: 'P', action: 'preview' },
        { keys: 'Space or right-drag', action: 'pan' },
      ],
    },
    {
      family: machineDisplayName(machineKind),
      rows: [
        { keys: 'Ctrl+Enter', action: 'start job' },
        { keys: 'Ctrl+.', action: 'stop job' },
      ],
    },
  ];
}

/** One line per family, e.g. `File: Ctrl+N new - Ctrl+O open`. */
export function shortcutHint(machineKind: MachineKind): string {
  return shortcutFamilies(machineKind)
    .map((entry) => {
      const rows = entry.rows.map((row) => `${row.keys} ${row.action}`).join(' - ');
      return `${entry.family}: ${rows}`;
    })
    .join('\n');
}
