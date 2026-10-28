import { describe, expect, it, vi } from 'vitest';
import { handleEditingToolShortcut, type EditingToolCtx } from './editing-tool-shortcuts';

function ctx(patch: Partial<EditingToolCtx> = {}): EditingToolCtx {
  return {
    hasSelection: true,
    rotateSelectionQuarterTurn: vi.fn(),
    rotateSelectionBy: vi.fn(),
    flipSelection: vi.fn(),
    pasteClipboardInPlace: vi.fn(),
    invertSelection: vi.fn(),
    toggleWireframeView: vi.fn(),
    deleteDuplicates: vi.fn(),
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

  it('routes Paste in Place (Alt+V), Invert Selection and the wireframe toggle', () => {
    const context = ctx();
    handleEditingToolShortcut(key({ key: 'v', code: 'KeyV', altKey: true }), context);
    // macOS Option+V types a square-root sign; the key position decides.
    handleEditingToolShortcut(key({ key: '√', code: 'KeyV', altKey: true }), context);
    handleEditingToolShortcut(key({ key: 'I', metaKey: true, shiftKey: true }), context);
    handleEditingToolShortcut(key({ key: '∑', code: 'KeyW', altKey: true }), context);
    expect(context.pasteClipboardInPlace).toHaveBeenCalledTimes(2);
    expect(context.invertSelection).toHaveBeenCalledOnce();
    expect(context.toggleWireframeView).toHaveBeenCalledOnce();
  });

  // Rolling audit v7 L8-P2-1: LightBurn's Flip Vertical chord pasted a hidden
  // copy on the copied artwork, so the part burned twice.
  it('flips with Ctrl+Shift+H / Ctrl+Shift+V and never pastes on them (LightBurn)', () => {
    const context = ctx();
    const horizontal = key({ key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true });
    const vertical = key({ key: 'V', code: 'KeyV', metaKey: true, shiftKey: true });
    expect(handleEditingToolShortcut(horizontal, context)).toBe(true);
    expect(handleEditingToolShortcut(vertical, context)).toBe(true);
    expect(context.flipSelection).toHaveBeenNthCalledWith(1, 'horizontal');
    expect(context.flipSelection).toHaveBeenNthCalledWith(2, 'vertical');
    expect(horizontal.defaultPrevented && vertical.defaultPrevented).toBe(true);
    expect(context.pasteClipboardInPlace).not.toHaveBeenCalled();
  });

  it('consumes a flip chord with nothing selected, and does nothing', () => {
    const context = ctx({ hasSelection: false });
    const chord = key({ key: 'H', ctrlKey: true, shiftKey: true });
    expect(handleEditingToolShortcut(chord, context)).toBe(true);
    expect(chord.defaultPrevented).toBe(true);
    expect(context.flipSelection).not.toHaveBeenCalled();
  });

  it('leaves Alt+Shift+V (Move V Together) and Ctrl+Alt+V to other handlers', () => {
    const context = ctx();
    for (const init of [
      { key: 'V', code: 'KeyV', altKey: true, shiftKey: true },
      { key: 'v', code: 'KeyV', altKey: true, ctrlKey: true },
    ]) {
      expect(handleEditingToolShortcut(key(init), context)).toBe(false);
    }
    expect(context.pasteClipboardInPlace).not.toHaveBeenCalled();
    expect(context.flipSelection).not.toHaveBeenCalled();
  });

  it.each([
    ['Shift+.', { key: '>', code: 'Period', shiftKey: true }, 45],
    ['Shift+,', { key: '<', code: 'Comma', shiftKey: true }, -45],
    ['Ctrl+Shift+.', { key: '>', code: 'Period', shiftKey: true, ctrlKey: true }, 1.5],
    ['Cmd+Shift+,', { key: '<', code: 'Comma', shiftKey: true, metaKey: true }, -1.5],
  ] as ReadonlyArray<[string, KeyboardEventInit, number]>)(
    '%s turns the selection %s° (LightBurn)',
    (_name, init, deltaDeg) => {
      const context = ctx();
      const event = key(init);
      expect(handleEditingToolShortcut(event, context)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(context.rotateSelectionBy).toHaveBeenCalledExactlyOnceWith(deltaDeg);
      expect(context.rotateSelectionQuarterTurn).not.toHaveBeenCalled();
    },
  );

  it('leaves a Shift chord that types . or , to the 90° turn, Abort and Settings', () => {
    // On AZERTY, Shift on the Comma-position key types a full stop.
    const context = ctx();
    expect(
      handleEditingToolShortcut(key({ key: '.', code: 'Comma', shiftKey: true }), context),
    ).toBe(true);
    expect(context.rotateSelectionQuarterTurn).toHaveBeenCalledExactlyOnceWith(1);
    for (const init of [
      { key: '.', code: 'Comma', shiftKey: true, ctrlKey: true },
      { key: ',', code: 'Period', shiftKey: true, metaKey: true },
      { key: '>', code: 'Period', shiftKey: true, altKey: true },
    ]) {
      expect(handleEditingToolShortcut(key(init), context)).toBe(false);
    }
    expect(context.rotateSelectionBy).not.toHaveBeenCalled();
    const idle = ctx({ hasSelection: false });
    const shifted = key({ key: '>', code: 'Period', shiftKey: true });
    expect(handleEditingToolShortcut(shifted, idle)).toBe(false);
    expect(shifted.defaultPrevented).toBe(false);
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

  it('deletes duplicates with Alt+D, also where Option+D types a symbol (ADR-480)', () => {
    const context = ctx();
    const chord = key({ key: '∂', code: 'KeyD', altKey: true });
    expect(handleEditingToolShortcut(chord, context)).toBe(true);
    expect(chord.defaultPrevented).toBe(true);
    expect(handleEditingToolShortcut(key({ key: 'd' }), context)).toBe(false);
    expect(context.deleteDuplicates).toHaveBeenCalledOnce();
  });
});
