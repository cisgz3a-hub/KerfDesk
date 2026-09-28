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
    canDistribute: true,
    alignSelection: vi.fn(),
    distributeSelection: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('align and distribute shortcuts', () => {
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
    expect(context.distributeSelection).not.toHaveBeenCalled();
  });

  it('Alt+Shift+H and Alt+Shift+V distribute equal spacing, including macOS Option letters', () => {
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
    expect(context.distributeSelection).toHaveBeenNthCalledWith(1, 'horizontal-spacing');
    expect(context.distributeSelection).toHaveBeenNthCalledWith(2, 'vertical-spacing');
  });

  it('names the undo step after the command', () => {
    const before = createProject();
    const context = ctx({ alignSelection: () => void pushUndo(before, []) });
    handleArrangeShortcut(keydown({ key: 'ArrowLeft', altKey: true }), () => context);
    expect(undoStepName(before, createProject())).toBe('Align Left');
  });

  it('consumes the key without acting when too few objects are selected', () => {
    // Alt+Left must never fall through to the browser's Back.
    const context = ctx({ canAlign: false, canDistribute: false });
    const align = keydown({ key: 'ArrowLeft', altKey: true });
    const distribute = keydown({ key: 'h', code: 'KeyH', altKey: true, shiftKey: true });
    expect(handleArrangeShortcut(align, () => context)).toBe(true);
    expect(handleArrangeShortcut(distribute, () => context)).toBe(true);
    expect(align.defaultPrevented).toBe(true);
    expect(context.alignSelection).not.toHaveBeenCalled();
    expect(context.distributeSelection).not.toHaveBeenCalled();
  });

  it('distributes only with three or more objects, while aligning with two', () => {
    const context = ctx({ canDistribute: false });
    handleArrangeShortcut(
      keydown({ key: 'v', code: 'KeyV', altKey: true, shiftKey: true }),
      () => context,
    );
    handleArrangeShortcut(keydown({ key: 'ArrowUp', altKey: true }), () => context);
    expect(context.distributeSelection).not.toHaveBeenCalled();
    expect(context.alignSelection).toHaveBeenCalledWith('top');
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
    ]) {
      expect(handleArrangeShortcut(event, () => context)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(context.alignSelection).not.toHaveBeenCalled();
    expect(context.distributeSelection).not.toHaveBeenCalled();
  });

  it('shows each key beside its Arrange menu command, whether enabled or not', () => {
    for (const selection of [{ canAlignSelection: true, canDistributeSelection: true }, {}]) {
      const commands = buildAppCommands(baseCtx(selection));
      for (const entry of ARRANGE_SHORTCUT_KEYS) {
        expect(commands.find((command) => command.id === entry.id)?.shortcut).toBe(entry.label);
      }
    }
    const labels = ARRANGE_SHORTCUT_KEYS.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
