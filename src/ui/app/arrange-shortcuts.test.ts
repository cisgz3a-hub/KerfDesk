import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { buildAppCommands } from '../commands/command-registry';
import { baseCtx } from '../commands/command-registry-test-helpers';
import { ARRANGE_SHORTCUT_KEYS } from '../commands/arrange-shortcut-keys';
import { pushUndo } from '../state/scene-mutations';
import { undoStepName } from '../state/undo-step-names';
import { handleArrangeShortcut, type ArrangeShortcutCtx } from './arrange-shortcuts';

function keydown(init: KeyboardEventInit & { readonly target?: HTMLElement }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.target !== undefined) Object.defineProperty(event, 'target', { value: init.target });
  return event;
}

function ctx(overrides: Partial<ArrangeShortcutCtx> = {}): ArrangeShortcutCtx {
  return {
    canAlign: true,
    hasSelection: true,
    alignSelection: vi.fn(),
    moveSelectionTogether: vi.fn(),
    moveSelectionInDrawOrder: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('align, Move Together and draw-order shortcuts', () => {
  it.each([
    ['ArrowLeft', 'left'],
    ['ArrowRight', 'right'],
    ['ArrowUp', 'top'],
    ['ArrowDown', 'bottom'],
    ['PageUp', 'center-x'],
    ['PageDown', 'center-y'],
  ])('Alt+%s aligns %s', (key, kind) => {
    const context = ctx();
    const event = keydown({ key, altKey: true });
    expect(handleArrangeShortcut(event, () => context)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(context.alignSelection).toHaveBeenCalledWith(kind);
    expect(context.moveSelectionInDrawOrder).not.toHaveBeenCalled();
  });

  // Rolling audit v7 L8-P2-4: LightBurn's Move H / V Together keys ran
  // Distribute spacing here. LightBurn binds no Distribute-spacing key.
  it('Alt+Shift+H and Alt+Shift+V move the selection together, including macOS Option letters', () => {
    const context = ctx();
    handleArrangeShortcut(
      keydown({ key: 'H', code: 'KeyH', altKey: true, shiftKey: true }),
      () => context,
    );
    // macOS Option+Shift+V types a composed character; the key position decides.
    handleArrangeShortcut(
      keydown({ key: '◊', code: 'KeyV', altKey: true, shiftKey: true }),
      () => context,
    );
    expect(context.moveSelectionTogether).toHaveBeenNthCalledWith(1, 'horizontal');
    expect(context.moveSelectionTogether).toHaveBeenNthCalledWith(2, 'vertical');
  });

  // Rolling audit v7 L8-P2-3: LightBurn's draw-order keys.
  it.each([
    ['PgUp', { key: 'PageUp' }, 'forward'],
    ['PgDn', { key: 'PageDown' }, 'backward'],
    ['Ctrl+PgUp', { key: 'PageUp', ctrlKey: true }, 'front'],
    ['Ctrl+PgDn', { key: 'PageDown', ctrlKey: true }, 'back'],
    ['Cmd+PgDn', { key: 'PageDown', metaKey: true }, 'back'],
  ] as ReadonlyArray<[string, KeyboardEventInit, string]>)(
    '%s moves the selection %s in draw order',
    (_name, init, move) => {
      const context = ctx();
      const event = keydown(init);
      expect(handleArrangeShortcut(event, () => context)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(context.moveSelectionInDrawOrder).toHaveBeenCalledExactlyOnceWith(move);
      expect(context.alignSelection).not.toHaveBeenCalled();
    },
  );

  it('restacks one object, which has nothing to align with', () => {
    const context = ctx({ canAlign: false });
    handleArrangeShortcut(keydown({ key: 'PageUp' }), () => context);
    expect(context.moveSelectionInDrawOrder).toHaveBeenCalledExactlyOnceWith('forward');
  });

  it('leaves the draw-order Page keys to a focused list or the Artwork panel', () => {
    const context = ctx();
    const list = document.createElement('div');
    list.setAttribute('role', 'listbox');
    const panel = document.createElement('aside');
    panel.className = 'lf-artwork-panel';
    const row = document.createElement('button');
    panel.appendChild(row);
    document.body.append(list, panel);
    for (const event of [
      keydown({ key: 'PageDown', target: list }),
      keydown({ key: 'PageUp', ctrlKey: true, target: list }),
      keydown({ key: 'PageUp', target: row }),
    ]) {
      expect(handleArrangeShortcut(event, () => context)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(context.moveSelectionInDrawOrder).not.toHaveBeenCalled();
  });

  it('names a draw-order undo step after the command', () => {
    const before = createProject();
    const context = ctx({ moveSelectionInDrawOrder: () => void pushUndo(before, []) });
    handleArrangeShortcut(keydown({ key: 'PageDown', ctrlKey: true }), () => context);
    expect(undoStepName(before, createProject())).toBe('Send to Back');
  });

  it('names the undo step after the command', () => {
    const before = createProject();
    const context = ctx({ alignSelection: () => void pushUndo(before, []) });
    handleArrangeShortcut(keydown({ key: 'ArrowLeft', altKey: true }), () => context);
    expect(undoStepName(before, createProject())).toBe('Align Left');
  });

  it('consumes the key without acting when too few objects are selected', () => {
    // Alt+Left must never fall through to the browser's Back.
    const context = ctx({ canAlign: false, hasSelection: false });
    const align = keydown({ key: 'ArrowLeft', altKey: true });
    const together = keydown({ key: 'h', code: 'KeyH', altKey: true, shiftKey: true });
    const restack = keydown({ key: 'PageDown', ctrlKey: true });
    for (const event of [align, together, restack]) {
      expect(handleArrangeShortcut(event, () => context)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(context.alignSelection).not.toHaveBeenCalled();
    expect(context.moveSelectionTogether).not.toHaveBeenCalled();
    expect(context.moveSelectionInDrawOrder).not.toHaveBeenCalled();
  });

  it('ignores a held key, text fields, AltGr and other modifiers', () => {
    const context = ctx();
    const input = document.createElement('input');
    document.body.appendChild(input);
    const repeat = keydown({ key: 'ArrowLeft', altKey: true, repeat: true });
    expect(handleArrangeShortcut(repeat, () => context)).toBe(true);
    expect(repeat.defaultPrevented).toBe(true);
    for (const event of [
      keydown({ key: 'ArrowLeft', altKey: true, target: input }),
      keydown({ key: 'ArrowLeft', altKey: true, ctrlKey: true }),
      keydown({ key: 'ArrowLeft', altKey: true, shiftKey: true }),
      keydown({ key: 'ArrowLeft', altKey: true, metaKey: true }),
      keydown({ key: 'ArrowLeft' }),
      keydown({ key: 'h', code: 'KeyH', altKey: true }),
      keydown({ key: 'h', code: 'KeyH', altKey: true, shiftKey: true, ctrlKey: true }),
      // Ctrl/Cmd+Alt+PgUp / PgDn jog Z (ADR-493 Amendment 2); Shift+PgUp is free.
      keydown({ key: 'PageUp', ctrlKey: true, altKey: true }),
      keydown({ key: 'PageDown', metaKey: true, altKey: true }),
      keydown({ key: 'PageUp', shiftKey: true }),
      keydown({ key: 'PageDown', ctrlKey: true, shiftKey: true }),
    ]) {
      expect(handleArrangeShortcut(event, () => context)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(context.alignSelection).not.toHaveBeenCalled();
    expect(context.moveSelectionTogether).not.toHaveBeenCalled();
    expect(context.moveSelectionInDrawOrder).not.toHaveBeenCalled();
  });

  it('shows each key beside its Arrange menu command, whether enabled or not', () => {
    for (const selection of [{ canAlignSelection: true, hasSelection: true }, {}]) {
      const commands = buildAppCommands(baseCtx(selection));
      for (const entry of ARRANGE_SHORTCUT_KEYS) {
        expect(commands.find((command) => command.id === entry.id)?.shortcut).toBe(entry.label);
      }
    }
    const labels = ARRANGE_SHORTCUT_KEYS.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives Distribute spacing no key, as LightBurn gives none', () => {
    const commands = buildAppCommands(baseCtx({ canDistributeSelection: true }));
    for (const id of [
      'arrange.distribute-horizontal-spacing',
      'arrange.distribute-vertical-spacing',
    ]) {
      expect(commands.find((command) => command.id === id)?.shortcut).toBeUndefined();
    }
  });
});
