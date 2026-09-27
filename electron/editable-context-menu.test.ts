import { describe, expect, it } from 'vitest';
import { contextMenuEntries, type ContextMenuFacts } from './editable-context-menu';

const NO_FLAGS = {
  canUndo: false,
  canRedo: false,
  canCut: false,
  canCopy: false,
  canPaste: false,
  canSelectAll: false,
};

function facts(overrides: Partial<ContextMenuFacts>): ContextMenuFacts {
  return {
    isEditable: false,
    selectionText: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: NO_FLAGS,
    ...overrides,
  };
}

describe('text right-click menu', () => {
  it('shows nothing where the browser would show nothing', () => {
    expect(contextMenuEntries(facts({}))).toEqual([]);
    expect(contextMenuEntries(facts({ selectionText: '   ' }))).toEqual([]);
  });

  it('offers the edit commands a text field allows', () => {
    const entries = contextMenuEntries(
      facts({ isEditable: true, editFlags: { ...NO_FLAGS, canPaste: true, canSelectAll: true } }),
    );
    const roles = entries.flatMap((entry) =>
      entry.kind === 'role' ? [`${entry.role}:${String(entry.enabled)}`] : [],
    );
    expect(roles).toEqual([
      'undo:false',
      'redo:false',
      'cut:false',
      'copy:false',
      'paste:true',
      'selectAll:true',
    ]);
  });

  it('offers Copy for selected page text outside a field', () => {
    expect(
      contextMenuEntries(
        facts({ selectionText: 'G1 X10', editFlags: { ...NO_FLAGS, canCopy: true } }),
      ),
    ).toEqual([{ kind: 'role', role: 'copy', enabled: true }]);
  });

  it('puts spelling suggestions first for a misspelled word, at most five', () => {
    const entries = contextMenuEntries(
      facts({
        isEditable: true,
        misspelledWord: 'engarve',
        dictionarySuggestions: ['engrave', 'en grave', 'engraver', 'engraved', 'engraves', 'grave'],
      }),
    );
    expect(entries.slice(0, 7)).toEqual([
      { kind: 'replace-misspelling', word: 'engrave' },
      { kind: 'replace-misspelling', word: 'en grave' },
      { kind: 'replace-misspelling', word: 'engraver' },
      { kind: 'replace-misspelling', word: 'engraved' },
      { kind: 'replace-misspelling', word: 'engraves' },
      { kind: 'learn-spelling', word: 'engarve' },
      { kind: 'separator' },
    ]);
  });
});
