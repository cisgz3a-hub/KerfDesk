import { describe, expect, it, vi } from 'vitest';
import { handleEditingToolShortcut, type EditingToolCtx } from './editing-tool-shortcuts';

function ctx(patch: Partial<EditingToolCtx> = {}): EditingToolCtx {
  return {
    hasSelection: true,
    rotateSelectionQuarterTurn: vi.fn(),
    pasteClipboardInPlace: vi.fn(),
    invertSelection: vi.fn(),
    toggleWireframeView: vi.fn(),
    ...patch,
  };
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { cancelable: true, ...init });
}

describe('editing tool shortcuts (ADR-410)', () => {
  it('rotates the selection with . and ,', () => {
    const context = ctx();
    const period = key({ key: '.' });
    expect(handleEditingToolShortcut(period, context)).toBe(true);
    expect(handleEditingToolShortcut(key({ key: ',' }), context)).toBe(true);
    expect(context.rotateSelectionQuarterTurn).toHaveBeenNthCalledWith(1, 1);
    expect(context.rotateSelectionQuarterTurn).toHaveBeenNthCalledWith(2, -1);
    expect(period.defaultPrevented).toBe(true);
  });

  it('leaves Ctrl+. to Abort and a bare . alone with nothing selected', () => {
    const context = ctx();
    expect(handleEditingToolShortcut(key({ key: '.', ctrlKey: true }), context)).toBe(false);
    expect(handleEditingToolShortcut(key({ key: '.', metaKey: true }), context)).toBe(false);
    const idle = ctx({ hasSelection: false });
    const period = key({ key: '.' });
    expect(handleEditingToolShortcut(period, idle)).toBe(false);
    expect(period.defaultPrevented).toBe(false);
    expect(context.rotateSelectionQuarterTurn).not.toHaveBeenCalled();
  });

  it('routes Paste in Place, Invert Selection and the wireframe toggle', () => {
    const context = ctx();
    handleEditingToolShortcut(key({ key: 'V', ctrlKey: true, shiftKey: true }), context);
    handleEditingToolShortcut(key({ key: 'I', metaKey: true, shiftKey: true }), context);
    handleEditingToolShortcut(key({ key: '∑', code: 'KeyW', altKey: true }), context);
    expect(context.pasteClipboardInPlace).toHaveBeenCalledOnce();
    expect(context.invertSelection).toHaveBeenCalledOnce();
    expect(context.toggleWireframeView).toHaveBeenCalledOnce();
  });

  it('reads Alt+W by the letter typed when it is a Latin letter', () => {
    const context = ctx();
    // A layout that puts another letter on the physical W key keeps Alt+W on the W letter.
    expect(handleEditingToolShortcut(key({ key: 'x', code: 'KeyW', altKey: true }), context)).toBe(
      false,
    );
    expect(handleEditingToolShortcut(key({ key: 'w', code: 'KeyV', altKey: true }), context)).toBe(
      true,
    );
    expect(context.toggleWireframeView).toHaveBeenCalledOnce();
  });

  it('does not take plain Ctrl+V or Ctrl+I from Paste and Import', () => {
    const context = ctx();
    expect(handleEditingToolShortcut(key({ key: 'v', ctrlKey: true }), context)).toBe(false);
    expect(handleEditingToolShortcut(key({ key: 'i', ctrlKey: true }), context)).toBe(false);
  });

  it('stands down while the user types in a field', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const context = ctx();
    const event = key({ key: '.' });
    Object.defineProperty(event, 'target', { value: input });
    expect(handleEditingToolShortcut(event, context)).toBe(false);
    input.remove();
  });
});
