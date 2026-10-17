// Shortcut labels as the operator's keyboard shows them (ADR-606). KerfDesk
// writes every chord the Windows way ("Ctrl+Shift+V"), and its key handlers
// take Cmd for Ctrl on a Mac. On a Mac the labels therefore use the macOS
// symbols in Apple's order, Option before Shift before Command ("⇧⌘V"), as
// the Mac's own menus do. Nothing here changes which keys work.

import { isApplePlatform } from './operating-system';

const MAC_MODIFIERS: Readonly<Record<string, string>> = { Alt: '⌥', Shift: '⇧', Ctrl: '⌘' };
const MAC_MODIFIER_ORDER = ['Alt', 'Shift', 'Ctrl'] as const;
const MAC_KEYS: Readonly<Record<string, string>> = {
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  PgUp: '⇞',
  PgDn: '⇟',
  Enter: '↩',
};
// A chord ("Alt+Shift+H", "Ctrl+,"), or a modifier held on its own ("Ctrl (hold ...)").
const CHORD = /\b(?:(?:Ctrl|Alt|Shift)\+)+[^\s/]+|\b(?:Ctrl|Alt)\b(?!\+)/g;

/** `shortcut` as this computer's keyboard labels it. */
export function shortcutLabel(shortcut: string, apple: boolean = isApplePlatform()): string {
  return apple ? shortcut.replace(CHORD, macChord) : shortcut;
}

function macChord(chord: string): string {
  const parts = chord.split('+');
  const held = new Set<string>();
  while (parts.length > 1 && MAC_MODIFIERS[parts[0] ?? ''] !== undefined) {
    held.add(parts.shift() ?? '');
  }
  const key = parts.join('+');
  if (held.size === 0) return MAC_MODIFIERS[key] ?? key;
  const modifiers = MAC_MODIFIER_ORDER.filter((name) => held.has(name))
    .map((name) => MAC_MODIFIERS[name])
    .join('');
  const symbol = MAC_KEYS[key] ?? key;
  // A key named by a word ("arrows") reads better apart from its symbols.
  return /^[a-z]{2,}$/.test(symbol) ? `${modifiers} ${symbol}` : `${modifiers}${symbol}`;
}
