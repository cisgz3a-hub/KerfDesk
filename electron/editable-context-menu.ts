// The right-click menu for text (ADR-482). Chromium in a browser shows Cut,
// Copy, Paste and spelling suggestions on a text field; Electron shows nothing
// unless the app builds that menu itself, so on the desktop app a right-click
// in a text box did nothing. The canvas and the 3D views cancel their own
// contextmenu event, and a cancelled event never reaches main, so this menu
// appears only where the browser would have shown its own.

export type ContextMenuFacts = {
  readonly isEditable: boolean;
  readonly selectionText: string;
  readonly misspelledWord: string;
  readonly dictionarySuggestions: ReadonlyArray<string>;
  readonly editFlags: {
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly canCut: boolean;
    readonly canCopy: boolean;
    readonly canPaste: boolean;
    readonly canSelectAll: boolean;
  };
};

export type ContextMenuEntry =
  | { readonly kind: 'role'; readonly role: EditRole; readonly enabled: boolean }
  | { readonly kind: 'replace-misspelling'; readonly word: string }
  | { readonly kind: 'learn-spelling'; readonly word: string }
  | { readonly kind: 'separator' };

export type EditRole = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

const MAX_SUGGESTIONS = 5;

/** What to show for one right-click; empty means show nothing. */
export function contextMenuEntries(facts: ContextMenuFacts): ContextMenuEntry[] {
  if (facts.isEditable) return [...spellingEntries(facts), ...editableEntries(facts)];
  if (facts.selectionText.trim().length > 0) {
    return [{ kind: 'role', role: 'copy', enabled: facts.editFlags.canCopy }];
  }
  return [];
}

function spellingEntries(facts: ContextMenuFacts): ContextMenuEntry[] {
  if (facts.misspelledWord.length === 0) return [];
  return [
    ...facts.dictionarySuggestions
      .slice(0, MAX_SUGGESTIONS)
      .map((word): ContextMenuEntry => ({ kind: 'replace-misspelling', word })),
    { kind: 'learn-spelling', word: facts.misspelledWord },
    { kind: 'separator' },
  ];
}

function editableEntries(facts: ContextMenuFacts): ContextMenuEntry[] {
  const flags = facts.editFlags;
  return [
    { kind: 'role', role: 'undo', enabled: flags.canUndo },
    { kind: 'role', role: 'redo', enabled: flags.canRedo },
    { kind: 'separator' },
    { kind: 'role', role: 'cut', enabled: flags.canCut },
    { kind: 'role', role: 'copy', enabled: flags.canCopy },
    { kind: 'role', role: 'paste', enabled: flags.canPaste },
    { kind: 'separator' },
    { kind: 'role', role: 'selectAll', enabled: flags.canSelectAll },
  ];
}
