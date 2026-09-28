// Shortcut reference data — single source for the toolbar hover hint and the
// Keyboard Shortcuts dialog.
//
// Keep in sync with shortcuts.ts, nudge-step.ts, arrange-shortcut-keys.ts,
// settings-shortcut.ts, use-job-shortcuts.ts, use-jog-shortcuts.ts,
// jog-keyboard-map.ts, drag-state.ts, and workspace-pointer-snap.ts —
// the audit (M27/A.5) caught the old hint omitting four shipped shortcuts.
// The job-control family is machine-aware (ADR-101 §7): same keys, right noun.

import type { MachineKind } from '../../core/scene';
import { machineDisplayName } from '../machine/machine-labels';
import { DEFAULT_NUDGE_STEPS, type NudgeSteps } from '../state/nudge-preferences';

export type ShortcutRow = {
  readonly keys: string;
  readonly action: string;
};

export type ShortcutFamily = {
  readonly family: string;
  readonly rows: ReadonlyArray<ShortcutRow>;
};

// Keyboard jog, live while the jog pad is shown and enabled: Z focus on the
// Page keys, XY on LightBurn's Move-window keys (ADR-493, jog-keyboard-map.ts).
const JOG_SHORTCUT_ROWS: ReadonlyArray<ShortcutRow> = [
  { keys: 'PageUp/PageDown', action: 'jog Z (focus) up/down one step' },
  { keys: 'Ctrl+Shift+] / Ctrl+Shift+[', action: 'jog up/down one step, like the jog arrows' },
  { keys: 'Ctrl+Alt+[ / Ctrl+Alt+]', action: 'jog left/right one step' },
  {
    keys: 'Numpad 8/2/4/6 (Num Lock on)',
    action: 'jog up/down/left/right one step; 7/9/1/3 jog diagonally',
  },
];

// Canvas snapping overrides (LBG-F06, workspace-pointer-snap.ts, drag-snap.ts).
const SNAP_SHORTCUT_ROWS: ReadonlyArray<ShortcutRow> = [
  {
    keys: 'Alt (hold while dragging)',
    action: 'move, draw, measure or edit nodes without snapping',
  },
  { keys: 'Ctrl (hold while moving)', action: 'move without snapping' },
];

const FILE_SHORTCUT_ROWS: ReadonlyArray<ShortcutRow> = [
  { keys: 'Ctrl+N', action: 'new' },
  { keys: 'Ctrl+O', action: 'open' },
  { keys: 'Ctrl+S', action: 'save' },
  { keys: 'Ctrl+Shift+S', action: 'save as' },
  { keys: 'Ctrl+I', action: 'import' },
  { keys: 'Ctrl+Shift+E', action: 'export G-code' },
];

// Align and distribute (arrange-shortcut-keys.ts): LightBurn's Alt+arrow and
// Alt+PgUp/PgDn, plus Alt+Shift+H/V for equal spacing.
const ARRANGE_SHORTCUT_ROWS: ReadonlyArray<ShortcutRow> = [
  { keys: 'Alt+Left / Alt+Right', action: 'align left or right edges' },
  { keys: 'Alt+Up / Alt+Down', action: 'align top or bottom edges' },
  { keys: 'Alt+PgUp', action: 'align centres on one vertical line (Align Center X)' },
  { keys: 'Alt+PgDn', action: 'align centres on one horizontal line (Align Center Y)' },
  { keys: 'Alt+Shift+H', action: 'distribute with equal horizontal spacing' },
  { keys: 'Alt+Shift+V', action: 'distribute with equal vertical spacing' },
];

// Arrow-key nudge: the distances are an app preference (Edit → Settings).
function nudgeRows(steps: NudgeSteps): ReadonlyArray<ShortcutRow> {
  return [
    { keys: 'arrows', action: `nudge ${steps.normalMm} mm` },
    { keys: 'Shift+arrows', action: `nudge ${steps.largeMm} mm` },
    { keys: 'Ctrl+arrows', action: `fine nudge ${steps.fineMm} mm (distances: Edit → Settings)` },
  ];
}

export function shortcutFamilies(
  machineKind: MachineKind,
  nudgeSteps: NudgeSteps = DEFAULT_NUDGE_STEPS,
): ReadonlyArray<ShortcutFamily> {
  return [
    { family: 'File', rows: FILE_SHORTCUT_ROWS },
    {
      family: 'Tools',
      rows: [
        { keys: 'T', action: 'type and edit text on canvas' },
        { keys: 'Ctrl+R', action: 'rectangle' },
        { keys: 'Ctrl+E', action: 'ellipse' },
        { keys: 'Ctrl+L', action: 'pen' },
        { keys: 'Alt+M', action: 'measure' },
        { keys: 'Alt+T', action: 'trace selected image' },
        { keys: 'Ctrl+Shift+B', action: 'convert to bitmap' },
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
        { keys: 'Ctrl+Shift+I', action: 'invert selection' },
        { keys: 'Ctrl+C', action: 'copy' },
        { keys: 'Ctrl+X', action: 'cut' },
        { keys: 'Ctrl+V', action: 'paste' },
        { keys: 'Ctrl+Shift+V', action: 'paste in place' },
        { keys: 'Ctrl+D', action: 'duplicate' },
        { keys: 'Ctrl+G', action: 'group' },
        { keys: 'Ctrl+U', action: 'ungroup' },
        { keys: 'Delete/Backspace', action: 'remove' },
        { keys: 'Alt+D', action: 'delete duplicates' },
        { keys: 'Escape', action: 'deselect' },
        { keys: 'Ctrl+,', action: 'settings' },
      ],
    },
    {
      family: 'Transform',
      rows: [
        ...nudgeRows(nudgeSteps),
        { keys: 'H', action: 'flip horizontal' },
        { keys: 'V', action: 'flip vertical' },
        { keys: '. or ,', action: 'rotate 90° clockwise or counter-clockwise' },
        ...SNAP_SHORTCUT_ROWS,
      ],
    },
    { family: 'Arrange', rows: ARRANGE_SHORTCUT_ROWS },
    {
      family: 'View',
      rows: [
        { keys: 'F or 0', action: 'fit-to-bed' },
        { keys: 'Shift+F', action: 'fit-to-selection' },
        { keys: '+/-', action: 'zoom' },
        { keys: 'P', action: 'preview' },
        { keys: 'Alt+W', action: 'filled or wireframe view' },
        { keys: 'Space or right-drag', action: 'pan' },
      ],
    },
    {
      family: machineDisplayName(machineKind),
      rows: [
        { keys: 'Ctrl+Enter', action: 'start job' },
        { keys: 'Ctrl+.', action: 'abort the job or machine motion, or turn a latched Fire off' },
        ...JOG_SHORTCUT_ROWS,
      ],
    },
  ];
}

/** One line per family, e.g. `File: Ctrl+N new - Ctrl+O open`. */
export function shortcutHint(
  machineKind: MachineKind,
  nudgeSteps: NudgeSteps = DEFAULT_NUDGE_STEPS,
): string {
  return shortcutFamilies(machineKind, nudgeSteps)
    .map((entry) => {
      const rows = entry.rows.map((row) => `${row.keys} ${row.action}`).join(' - ');
      return `${entry.family}: ${rows}`;
    })
    .join('\n');
}
