import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCommandSearchShortcut } from '../app/command-search-shortcut';
import { CommandSearchDialog, CommandSearchHost } from './CommandSearchDialog';
import { useCommandSearchStore } from './command-search-store';
import { disabled, enabled, type AppCommand } from './command-types';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useCommandSearchStore.setState({ open: false });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  useCommandSearchStore.setState({ open: false });
});

function commandsWith(spies: {
  readonly save: () => void;
  readonly group: () => void;
  readonly box: () => void;
}): ReadonlyArray<AppCommand> {
  return [
    enabled('file.save', 'file', 'Save', 'Save the project', spies.save, 'Ctrl+S'),
    disabled('edit.group', 'edit', 'Group', 'Select two or more objects to group.', spies.group),
    enabled('tools.box-generator', 'tools', 'Box Generator...', 'Make a box', spies.box),
  ];
}

async function renderDialog(commands: ReadonlyArray<AppCommand>, onClose = vi.fn()) {
  await act(async () =>
    root.render(<CommandSearchDialog commands={commands} machineKind="laser" onClose={onClose} />),
  );
  const input = host.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (input === null) throw new Error('Missing search box');
  return { input, onClose };
}

async function type(input: HTMLInputElement, text: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function press(input: HTMLInputElement, key: string): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function optionLabels(): string[] {
  return [...host.querySelectorAll('[role="option"] .lf-command-search__label')].map(
    (node) => node.textContent ?? '',
  );
}

function selectedId(): string | null {
  return (
    host.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('data-command-id') ??
    null
  );
}

describe('CommandSearchDialog', () => {
  it('focuses the search box and lists every command before anything is typed', async () => {
    const { input } = await renderDialog(
      commandsWith({ save: vi.fn(), group: vi.fn(), box: vi.fn() }),
    );
    expect(document.activeElement).toBe(input);
    expect(optionLabels()).toEqual(['Save', 'Group', 'Box Generator...']);
    expect(host.textContent).toContain('Ctrl+S');
    expect(host.textContent).toContain('Tools');
  });

  it('runs the top result on Enter and closes first', async () => {
    const box = vi.fn();
    const { input, onClose } = await renderDialog(
      commandsWith({ save: vi.fn(), group: vi.fn(), box }),
    );
    await type(input, 'box');
    expect(optionLabels()).toEqual(['Box Generator...']);
    await press(input, 'Enter');
    expect(onClose).toHaveBeenCalledOnce();
    expect(box).toHaveBeenCalledOnce();
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(box.mock.invocationCallOrder[0] ?? 0);
  });

  it('moves the selection with the arrow keys, wrapping at the ends', async () => {
    const save = vi.fn();
    const { input } = await renderDialog(commandsWith({ save, group: vi.fn(), box: vi.fn() }));
    expect(selectedId()).toBe('file.save');
    await press(input, 'ArrowDown');
    expect(selectedId()).toBe('edit.group');
    await press(input, 'ArrowUp');
    await press(input, 'ArrowUp');
    expect(selectedId()).toBe('tools.box-generator');
    expect(input.getAttribute('aria-activedescendant')).toBe(
      host.querySelector('[aria-selected="true"]')?.id,
    );
  });

  it('shows why a disabled command is unavailable and does not run it', async () => {
    const group = vi.fn();
    const { input, onClose } = await renderDialog(
      commandsWith({ save: vi.fn(), group, box: vi.fn() }),
    );
    await type(input, 'group');
    const option = host.querySelector('[role="option"]');
    expect(option?.getAttribute('aria-disabled')).toBe('true');
    expect(option?.textContent).toContain('Select two or more objects to group.');
    await press(input, 'Enter');
    await act(async () => (option as HTMLElement).click());
    expect(group).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('runs a clicked result', async () => {
    const save = vi.fn();
    const { onClose } = await renderDialog(commandsWith({ save, group: vi.fn(), box: vi.fn() }));
    await act(async () =>
      host.querySelector<HTMLElement>('[data-command-id="file.save"]')?.click(),
    );
    expect(save).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('says so when nothing matches', async () => {
    const { input } = await renderDialog(
      commandsWith({ save: vi.fn(), group: vi.fn(), box: vi.fn() }),
    );
    await type(input, 'zzz');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      'No command matches “zzz”',
    );
  });
});

describe('CommandSearchHost and Ctrl+K', () => {
  it('Ctrl+K and Cmd+K open the search; other chords do not', () => {
    const open = vi.fn();
    const ctrlK = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    expect(handleCommandSearchShortcut(ctrlK, open)).toBe(true);
    expect(ctrlK.defaultPrevented).toBe(true);
    expect(
      handleCommandSearchShortcut(new KeyboardEvent('keydown', { key: 'K', metaKey: true }), open),
    ).toBe(true);
    expect(handleCommandSearchShortcut(new KeyboardEvent('keydown', { key: 'k' }), open)).toBe(
      false,
    );
    expect(
      handleCommandSearchShortcut(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, shiftKey: true }),
        open,
      ),
    ).toBe(false);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('renders only while the store says open and closes on Escape', async () => {
    const commands = commandsWith({ save: vi.fn(), group: vi.fn(), box: vi.fn() });
    await act(async () =>
      root.render(<CommandSearchHost commands={commands} machineKind="laser" />),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => useCommandSearchStore.getState().openCommandSearch());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(useCommandSearchStore.getState().open).toBe(false);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
