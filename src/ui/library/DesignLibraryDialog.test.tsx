import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { DesignLibraryDialog } from './DesignLibraryDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderDialog(): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<DesignLibraryDialog />);
  });
  return host;
}

beforeEach(() => {
  resetStore();
  useUiStore.getState().setLibraryDialogOpen(true);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('DesignLibraryDialog', () => {
  it('shows professional categories and filters', async () => {
    const h = await renderDialog();
    expect(h.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Design library');
    expect(h.textContent).toContain('Laser Templates');
    expect(h.textContent).toContain('CNC Templates');
    expect(h.querySelector('input[aria-label="Search design library"]')).not.toBeNull();
    expect(h.querySelector('select[aria-label="Machine filter"]')).not.toBeNull();
    expect(h.querySelector('select[aria-label="Operation filter"]')).not.toBeNull();
  });

  it('filters by search text and inserts a visible entry', async () => {
    const h = await renderDialog();
    const search = h.querySelector('input[aria-label="Search design library"]') as HTMLInputElement;
    await act(async () => {
      search.value = 'kerf';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(h.textContent).toContain('Kerf');
    const before = useStore.getState().project.scene.objects.length;
    const insert = h.querySelector('button[aria-label^="Insert Kerf"]') as HTMLButtonElement;
    await act(async () => insert.click());
    expect(useStore.getState().project.scene.objects.length).toBeGreaterThan(before);
  });

  it('imports only the currently visible filtered entries', async () => {
    const h = await renderDialog();
    const machine = h.querySelector('select[aria-label="Machine filter"]') as HTMLSelectElement;
    await act(async () => {
      machine.value = 'cnc';
      machine.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const visibleCards = h.querySelectorAll('[data-library-card]').length;
    const before = useStore.getState().project.scene.objects.length;
    const importVisible = h.querySelector(
      'button[aria-label="Import visible library entries"]',
    ) as HTMLButtonElement;
    await act(async () => importVisible.click());
    expect(useStore.getState().project.scene.objects.length).toBeGreaterThan(before);
    expect(visibleCards).toBeGreaterThan(0);
  });
});
