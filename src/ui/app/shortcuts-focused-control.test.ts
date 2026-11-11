// Annoyance audit A4-P2-2: after a tick box, slider, colour button or drop-down
// was the last thing touched, the design shortcuts must still work, and the
// keys that work that control must still go to it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleArrangeShortcut, type ArrangeShortcutCtx } from './arrange-shortcuts';
import { handleEditingToolShortcut, type EditingToolCtx } from './editing-tool-shortcuts';
import {
  handleEditShortcut,
  handleToolShortcut,
  handleTransformShortcut,
  handleViewShortcut,
} from './shortcuts';
import { createProject } from '../../core/scene';

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const element of mounted.splice(0)) element.remove();
});

function control(tag: 'input' | 'select' | 'textarea', type?: string): HTMLElement {
  const element = document.createElement(tag);
  if (type !== undefined) element.setAttribute('type', type);
  document.body.appendChild(element);
  mounted.push(element);
  return element;
}

function keydown(
  target: HTMLElement,
  key: string,
  modifiers: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  Object.defineProperty(event, 'target', { value: target, configurable: true });
  return event;
}

function editCtx(): Parameters<typeof handleEditShortcut>[1] {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    selectedObjectId: 'O1',
    selectedPathNode: null,
    additionalSelectedIds: new Set<string>(),
    removeSceneObjects: vi.fn(),
    deleteSelectedPathNodes: vi.fn(),
    selectObject: vi.fn(),
    selectAllObjects: vi.fn(),
    duplicateSelection: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    pasteClipboard: vi.fn(),
    groupSelection: vi.fn(),
    ungroupSelection: vi.fn(),
    resetToolMode: vi.fn(),
  };
}

function transformCtx(): Parameters<typeof handleTransformShortcut>[1] {
  return {
    project: createProject(),
    selectedObjectId: 'O1',
    selectedPathNode: null,
    applyObjectTransform: vi.fn(),
    nudgeSelection: vi.fn(),
    nudgeSelectedPathNode: vi.fn(),
    flipSelection: vi.fn(),
  };
}

const NON_TEXT_CONTROLS: ReadonlyArray<readonly [string, () => HTMLElement]> = [
  ['a tick box', () => control('input', 'checkbox')],
  ['a radio button', () => control('input', 'radio')],
  ['a slider', () => control('input', 'range')],
  ['a colour button', () => control('input', 'color')],
  ['a drop-down', () => control('select')],
];

const TEXT_CONTROLS: ReadonlyArray<readonly [string, () => HTMLElement]> = [
  ['a text field', () => control('input', 'text')],
  ['a field with no type', () => control('input')],
  ['a number field', () => control('input', 'number')],
  ['a search field', () => control('input', 'search')],
  ['a text area', () => control('textarea')],
];

describe('edit shortcuts after a panel control was touched (A4-P2-2)', () => {
  it.each(NON_TEXT_CONTROLS)('Delete removes the selection from %s', (_name, make) => {
    const ctx = editCtx();
    const event = keydown(make(), 'Delete');
    expect(handleEditShortcut(event, ctx)).toBe(true);
    expect(ctx.removeSceneObjects).toHaveBeenCalledWith(['O1']);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each(NON_TEXT_CONTROLS)('Ctrl+Z, Ctrl+Y, copy and paste work from %s', (_name, make) => {
    const ctx = editCtx();
    const target = make();
    for (const key of ['z', 'y', 'c', 'v']) {
      expect(handleEditShortcut(keydown(target, key, { ctrlKey: true }), ctx)).toBe(true);
    }
    expect(ctx.undo).toHaveBeenCalledTimes(1);
    expect(ctx.redo).toHaveBeenCalledTimes(1);
    expect(ctx.copySelection).toHaveBeenCalledTimes(1);
    expect(ctx.pasteClipboard).toHaveBeenCalledTimes(1);
  });

  it.each(NON_TEXT_CONTROLS)('Esc clears the selection from %s', (_name, make) => {
    const ctx = editCtx();
    expect(handleEditShortcut(keydown(make(), 'Escape'), ctx)).toBe(true);
    expect(ctx.selectObject).toHaveBeenCalledWith(null);
  });

  it.each(TEXT_CONTROLS)('%s keeps Delete, Backspace, Ctrl+Z and Ctrl+A', (_name, make) => {
    const ctx = editCtx();
    const target = make();
    expect(handleEditShortcut(keydown(target, 'Delete'), ctx)).toBe(false);
    expect(handleEditShortcut(keydown(target, 'Backspace'), ctx)).toBe(false);
    expect(handleEditShortcut(keydown(target, 'z', { ctrlKey: true }), ctx)).toBe(false);
    expect(handleEditShortcut(keydown(target, 'a', { ctrlKey: true }), ctx)).toBe(false);
    expect(ctx.removeSceneObjects).not.toHaveBeenCalled();
    expect(ctx.undo).not.toHaveBeenCalled();
    expect(ctx.selectAllObjects).not.toHaveBeenCalled();
  });
});

describe('the keys that work a focused control stay with it (A4-P2-2)', () => {
  it.each([
    ['a slider', () => control('input', 'range')],
    ['a radio button', () => control('input', 'radio')],
    ['a drop-down', () => control('select')],
  ] as const)('an arrow key on %s does not nudge the artwork', (_name, make) => {
    const ctx = transformCtx();
    const target = make();
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const event = keydown(target, key);
      expect(handleTransformShortcut(event, ctx)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    const fine = keydown(target, 'ArrowLeft', { ctrlKey: true });
    const large = keydown(target, 'ArrowLeft', { shiftKey: true });
    expect(handleTransformShortcut(fine, ctx)).toBe(false);
    expect(handleTransformShortcut(large, ctx)).toBe(false);
    expect(ctx.nudgeSelection).not.toHaveBeenCalled();
  });

  it('an arrow key on a tick box nudges, as it does from a button', () => {
    const ctx = transformCtx();
    expect(handleTransformShortcut(keydown(control('input', 'checkbox'), 'ArrowLeft'), ctx)).toBe(
      true,
    );
    expect(ctx.nudgeSelection).toHaveBeenCalledTimes(1);
  });

  it('a letter on a drop-down jumps to an option and runs no shortcut', () => {
    const select = control('select');
    const transform = transformCtx();
    const setToolMode = vi.fn();
    const togglePreview = vi.fn();
    const tools = {
      setToolMode,
      openConvertToBitmap: vi.fn(),
      openTraceImage: vi.fn(),
      refreshCameraPicture: vi.fn(),
    };
    const view = {
      togglePreview,
      resetView: vi.fn(),
      zoomBy: vi.fn(),
      fitToSelection: vi.fn(),
      toggleSidePanels: vi.fn(),
    };
    expect(handleTransformShortcut(keydown(select, 'h'), transform)).toBe(false);
    expect(handleToolShortcut(keydown(select, 't'), tools)).toBe(false);
    expect(handleViewShortcut(keydown(select, 'p'), view)).toBe(false);
    expect(handleViewShortcut(keydown(select, '-'), view)).toBe(false);
    expect(transform.flipSelection).not.toHaveBeenCalled();
    expect(setToolMode).not.toHaveBeenCalled();
    expect(togglePreview).not.toHaveBeenCalled();
    expect(view.zoomBy).not.toHaveBeenCalled();
  });

  it('a letter on a tick box or slider still runs its shortcut', () => {
    const transform = transformCtx();
    const view = {
      togglePreview: vi.fn(),
      resetView: vi.fn(),
      zoomBy: vi.fn(),
      fitToSelection: vi.fn(),
      toggleSidePanels: vi.fn(),
    };
    expect(handleTransformShortcut(keydown(control('input', 'checkbox'), 'h'), transform)).toBe(
      true,
    );
    expect(handleViewShortcut(keydown(control('input', 'range'), 'p'), view)).toBe(true);
    expect(transform.flipSelection).toHaveBeenCalledWith('horizontal');
    expect(view.togglePreview).toHaveBeenCalledTimes(1);
  });

  it('Space and Enter on a tick box, button input or drop-down run no shortcut', () => {
    const ctx = editCtx();
    expect(handleEditShortcut(keydown(control('input', 'checkbox'), ' '), ctx)).toBe(false);
    expect(handleEditShortcut(keydown(control('input', 'color'), 'Enter'), ctx)).toBe(false);
    expect(handleEditShortcut(keydown(control('select'), 'Enter'), ctx)).toBe(false);
  });
});

describe('the rotate and arrange keys follow the same rule (A4-P2-2)', () => {
  function editingCtx(): EditingToolCtx {
    return {
      hasSelection: true,
      rotateSelectionQuarterTurn: vi.fn(),
      rotateSelectionBy: vi.fn(),
      flipSelection: vi.fn(),
      pasteClipboardInPlace: vi.fn(),
      invertSelection: vi.fn(),
      toggleWireframeView: vi.fn(),
      deleteDuplicates: vi.fn(),
    };
  }

  function arrangeCtx(): ArrangeShortcutCtx {
    return {
      canAlign: true,
      hasSelection: true,
      alignSelection: vi.fn(),
      moveSelectionTogether: vi.fn(),
      moveSelectionInDrawOrder: vi.fn(),
    };
  }

  it('a full stop turns the selection from a tick box, not from a drop-down or text field', () => {
    const ctx = editingCtx();
    expect(handleEditingToolShortcut(keydown(control('input', 'checkbox'), '.'), ctx)).toBe(true);
    expect(handleEditingToolShortcut(keydown(control('select'), '.'), ctx)).toBe(false);
    expect(handleEditingToolShortcut(keydown(control('input', 'number'), '.'), ctx)).toBe(false);
    expect(ctx.rotateSelectionQuarterTurn).toHaveBeenCalledTimes(1);
  });

  it('Alt+Left aligns from a tick box, and stays with a slider or drop-down', () => {
    const ctx = arrangeCtx();
    const context = (): ArrangeShortcutCtx => ctx;
    const alt = { altKey: true };
    expect(
      handleArrangeShortcut(keydown(control('input', 'checkbox'), 'ArrowLeft', alt), context),
    ).toBe(true);
    expect(
      handleArrangeShortcut(keydown(control('input', 'range'), 'ArrowLeft', alt), context),
    ).toBe(false);
    expect(handleArrangeShortcut(keydown(control('select'), 'ArrowDown', alt), context)).toBe(
      false,
    );
    expect(ctx.alignSelection).toHaveBeenCalledTimes(1);
  });
});
