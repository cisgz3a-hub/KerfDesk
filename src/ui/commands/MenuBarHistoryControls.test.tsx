import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppMenuBar } from './AppMenuBar';
import { buildAppCommands } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';
import type { AppCommandContext } from './command-types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderMenuBar(overrides: Partial<AppCommandContext>): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const commands = buildAppCommands(baseCtx(overrides));
  await act(async () => root?.render(<AppMenuBar commands={commands} machineKind="laser" />));
  return host;
}

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

function control(container: HTMLElement, label: string): HTMLButtonElement {
  const button = container.querySelector(
    `[aria-label="Edit history"] button[aria-label="${label}"]`,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} button missing`);
  return button;
}

describe('MenuBarHistoryControls', () => {
  it('runs Undo and Redo from the menu bar and mirrors their command state', async () => {
    const undo = vi.fn();
    const redo = vi.fn();
    const container = await renderMenuBar({ canUndo: true, canRedo: true, undo, redo });

    // Beside Help, not inside the menubar: a role="menubar" takes menuitems only.
    const group = container.querySelector('[aria-label="Edit history"]');
    const menubar = container.querySelector('[role="menubar"]');
    if (group === null || menubar === null) throw new Error('menu bar history group missing');
    expect(group.closest('[role="menubar"]')).toBeNull();
    expect(group.compareDocumentPosition(menubar) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

    expect(control(container, 'Undo').title).toContain('(Ctrl+Z)');
    await act(async () => control(container, 'Undo').click());
    await act(async () => control(container, 'Redo').click());
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('disables each button when its own history is empty, and never hides it', async () => {
    const undo = vi.fn();
    const container = await renderMenuBar({ canUndo: false, canRedo: true, undo });

    expect(control(container, 'Undo').disabled).toBe(true);
    expect(control(container, 'Undo').title).toContain('Nothing to undo.');
    expect(control(container, 'Redo').disabled).toBe(false);

    await act(async () => control(container, 'Undo').click());
    expect(undo).not.toHaveBeenCalled();
  });
});
