import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleEditShortcut, type EditCtx } from './shortcuts';

// Alt+D — Delete Duplicates, LightBurn's binding (ADR-377).

describe('handleEditShortcut — Alt+D delete duplicates', () => {
  const canvas = document.createElement('div');
  document.body.appendChild(canvas);
  afterEach(() => vi.clearAllMocks());

  it('deletes duplicates on Alt+D only, not on Ctrl+D or Ctrl+Alt+D', () => {
    const ctx = editCtx();

    expect(handleEditShortcut(keydown({ key: 'd', altKey: true }), ctx)).toBe(true);
    expect(ctx.deleteDuplicates).toHaveBeenCalledTimes(1);
    expect(ctx.duplicateSelection).not.toHaveBeenCalled();

    handleEditShortcut(keydown({ key: 'd', ctrlKey: true }), ctx);
    handleEditShortcut(keydown({ key: 'd', altKey: true, ctrlKey: true }), ctx);
    expect(ctx.deleteDuplicates).toHaveBeenCalledTimes(1);
  });

  it('matches the key position when macOS Option turns D into a symbol', () => {
    const ctx = editCtx();

    expect(handleEditShortcut(keydown({ key: '∂', code: 'KeyD', altKey: true }), ctx)).toBe(true);
    expect(ctx.deleteDuplicates).toHaveBeenCalledTimes(1);
  });

  it('leaves Alt+D to a focused text field', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ctx = editCtx();

    expect(handleEditShortcut(keydown({ key: 'd', altKey: true }, input), ctx)).toBe(false);
    expect(ctx.deleteDuplicates).not.toHaveBeenCalled();
    input.remove();
  });

  function keydown(init: KeyboardEventInit, target: HTMLElement = canvas): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: target, configurable: true });
    return event;
  }
});

function editCtx(): EditCtx {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    selectedObjectId: null,
    selectedPathNode: null,
    additionalSelectedIds: new Set<string>(),
    removeSceneObjects: vi.fn(),
    deleteSelectedPathNodes: vi.fn(),
    selectObject: vi.fn(),
    selectAllObjects: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    pasteClipboard: vi.fn(),
    groupSelection: vi.fn(),
    ungroupSelection: vi.fn(),
    duplicateSelection: vi.fn(),
    deleteDuplicates: vi.fn(),
    resetToolMode: vi.fn(),
  };
}
