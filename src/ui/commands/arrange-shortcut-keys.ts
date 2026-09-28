// Keyboard shortcuts for the Arrange menu's align and distribute commands
// (Rayforge comparison: eight align shortcuts). One table feeds both the menu's
// shortcut column (arrange-command-family.ts) and the key handler
// (app/arrange-shortcuts.ts), so the two cannot disagree.
//
// The keys are LightBurn's: Alt/Option+arrow aligns to that edge, and
// Alt+PgUp / Alt+PgDn align the centres. LightBurn binds no distribute key, so
// those take Figma's Alt+Shift+H / Alt+Shift+V (equal spacing). Rayforge's
// Shift+arrow cannot be used here — it is the 10 mm nudge — and its Ctrl+Shift+V
// is Paste in Place. None of these collide with keyboard jog (Ctrl/Cmd+Alt or
// Ctrl/Cmd+Shift with a bracket, the keypad, bare PgUp/PgDn), with the Ctrl/Cmd+
// arrow fine nudge, or with Alt held to drag without snapping (a key press, not
// a held modifier during a drag).

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
    id: 'arrange.distribute-horizontal-spacing',
    label: 'Alt+Shift+H',
    matches: altShiftLetter('h'),
  },
  {
    id: 'arrange.distribute-vertical-spacing',
    label: 'Alt+Shift+V',
    matches: altShiftLetter('v'),
  },
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
