import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readWorkspaceLayoutPreference,
  useWorkspaceLayoutStore,
  WORKSPACE_LAYOUT_STORAGE_KEY,
} from '../state/workspace-layout-store';
import { WorkspaceLayoutSelect } from './WorkspaceLayoutSelect';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
beforeEach(() => {
  localStorage.removeItem(WORKSPACE_LAYOUT_STORAGE_KEY);
  useWorkspaceLayoutStore.setState({ preference: 'auto', resetRevision: 0 });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe('Workspace layout menu', () => {
  it('opens a checked radio menu with the saved choice and exposes the current value', async () => {
    useWorkspaceLayoutStore.setState({ preference: 'compact' });
    await render();
    const trigger = button('Workspace layout');
    expect(document.querySelector('select')).toBeNull();
    const valueId = trigger.getAttribute('aria-describedby');
    expect(document.getElementById(valueId ?? '')?.textContent).toBe('Compact');
    await act(async () => trigger.click());
    const menu = document.querySelector('[role="menu"][aria-label="Workspace layout options"]');
    expect(menu?.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3);
    expect(checkedOptions()).toEqual(['Compact']);
    expect(document.activeElement).toBe(button('Compact'));
    expect(trigger.getAttribute('aria-controls')).toBe(menu?.id);
  });

  it('navigates without changing preferences, then saves and restores the chosen layout', async () => {
    await render();
    const trigger = button('Workspace layout');
    trigger.focus();
    const bubbledKey = vi.fn();
    document.addEventListener('keydown', bubbledKey);
    try {
      expect((await press('ArrowDown')).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(button('Auto layout'));
      await press('ArrowUp');
      expect(document.activeElement).toBe(button('Spacious'));
      await press('Home');
      expect(document.activeElement).toBe(button('Auto layout'));
      await press('End');
      expect(document.activeElement).toBe(button('Spacious'));
      await press('ArrowLeft');
      expect(document.activeElement).toBe(button('Compact'));
      expect(checkedOptions()).toEqual(['Auto layout']);
      expect(localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY)).toBeNull();
      expect(useWorkspaceLayoutStore.getState().preference).toBe('auto');
      expect(bubbledKey).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', bubbledKey);
    }
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY)).toBe('compact');
    await act(async () => root?.unmount());
    host?.remove();
    useWorkspaceLayoutStore.setState({ preference: readWorkspaceLayoutPreference() });
    await render();
    await act(async () => button('Workspace layout').click());
    expect(checkedOptions()).toEqual(['Compact']);
    expect(document.activeElement).toBe(button('Compact'));
  });

  it('dismisses on Escape, Tab and outside input without changing the choice', async () => {
    await render();
    const trigger = button('Workspace layout');
    trigger.focus();
    await press('ArrowUp');
    await press('End');
    expect((await press('Escape')).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => trigger.click());
    expect((await press('Tab')).defaultPrevented).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => trigger.click());
    const outside = button('Outside control');
    outside.focus();
    await act(async () => outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(document.activeElement).toBe(outside);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY)).toBeNull();
    expect(useWorkspaceLayoutStore.getState().preference).toBe('auto');
  });
});

async function render(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(
      <>
        <WorkspaceLayoutSelect />
        <button type="button" aria-label="Outside control">
          Outside
        </button>
      </>,
    );
  });
}

function button(label: string): HTMLButtonElement {
  const element = document.querySelector(`button[aria-label="${label}"]`);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`${label} missing`);
  return element;
}

function checkedOptions(): Array<string | null> {
  return [...document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')].map(
    (element) => element.getAttribute('aria-label'),
  );
}

async function press(key: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => document.activeElement?.dispatchEvent(event));
  return event;
}
