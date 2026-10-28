// Keyboard shortcuts for the Arrange menu's align, Move Together and draw-order
// commands. One table feeds both the menu's shortcut column
// (arrange-command-family.ts, layout-commands.ts) and the key handler
// (app/arrange-shortcuts.ts), so the two cannot disagree.
//
// The keys are LightBurn's (Windows hotkey cheatsheet Rev 2.0, 1.7 Distribute
// page): Alt/Option+arrow aligns to that edge, Alt+PgUp / Alt+PgDn align the
// centres, Alt+Shift+H / Alt+Shift+V move the selection together, PgUp / PgDn
// push it forward or backward in draw order and Ctrl+PgUp / Ctrl+PgDn to the
// front or back. LightBurn binds no Distribute-spacing key, so neither does
// KerfDesk (ADR-499 Amendment 2). Keyboard Z jog is Ctrl/Cmd+Alt+PgUp / PgDn
// (ADR-493 Amendment 2), which none of these match. Nor do they collide with the
// bracket XY jog, the Ctrl/Cmd+arrow fine nudge, or Alt held to drag without
// snapping (a key press, not a held modifier during a drag).

import type { CommandId } from './command-types';

type ArrangeKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'
>;

type ArrangeShortcutKey = {
  readonly id: CommandId;
  readonly label: string;
  readonly matches: (event: ArrangeKeyEvent) => boolean;
};

export const ARRANGE_SHORTCUT_KEYS: ReadonlyArray<ArrangeShortcutKey> = [
  { id: 'arrange.align-left', label: 'Alt+Left', matches: altKey('ArrowLeft') },
  { id: 'arrange.align-right', label: 'Alt+Right', matches: altKey('ArrowRight') },
  { id: 'arrange.align-top', label: 'Alt+Up', matches: altKey('ArrowUp') },
  { id: 'arrange.align-bottom', label: 'Alt+Down', matches: altKey('ArrowDown') },
  { id: 'arrange.align-center-x', label: 'Alt+PgUp', matches: altKey('PageUp') },
  { id: 'arrange.align-center-y', label: 'Alt+PgDn', matches: altKey('PageDown') },
  {
    id: 'arrange.move-together-horizontal',
    label: 'Alt+Shift+H',
    matches: altShiftLetter('h'),
  },
  {
    id: 'arrange.move-together-vertical',
    label: 'Alt+Shift+V',
    matches: altShiftLetter('v'),
  },
  { id: 'arrange.bring-forward', label: 'PgUp', matches: bareKey('PageUp') },
  { id: 'arrange.send-backward', label: 'PgDn', matches: bareKey('PageDown') },
  { id: 'arrange.bring-to-front', label: 'Ctrl+PgUp', matches: ctrlKey('PageUp') },
  { id: 'arrange.send-to-back', label: 'Ctrl+PgDn', matches: ctrlKey('PageDown') },
];

export function arrangeShortcutLabel(id: CommandId): string | undefined {
  return ARRANGE_SHORTCUT_KEYS.find((entry) => entry.id === id)?.label;
}

export function arrangeShortcutCommandId(event: ArrangeKeyEvent): CommandId | null {
  return ARRANGE_SHORTCUT_KEYS.find((entry) => entry.matches(event))?.id ?? null;
}

// Alt/Option alone. Windows AltGr arrives as Ctrl+Alt, so it never matches.
function altKey(key: string): (event: ArrangeKeyEvent) => boolean {
  return (event) =>
    event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.key === key;
}

function bareKey(key: string): (event: ArrangeKeyEvent) => boolean {
  return (event) =>
    !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.key === key;
}

// Ctrl or Cmd alone.
function ctrlKey(key: string): (event: ArrangeKeyEvent) => boolean {
  return (event) =>
    (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === key;
}

// Alt/Option+Shift plus a letter. macOS Option composes a character (Option+
// Shift+H types Ó), so a key that is not a Latin letter is read by its
// US-QWERTY position, the same rule as isAltLetterChord in shortcuts.ts.
function altShiftLetter(letter: string): (event: ArrangeKeyEvent) => boolean {
  return (event) => {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return false;
    const key = event.key.toLowerCase();
    return key === letter || (!/^[a-z]$/u.test(key) && event.code === `Key${letter.toUpperCase()}`);
  };
}
