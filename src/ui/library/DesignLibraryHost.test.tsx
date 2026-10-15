import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { DesignLibraryHost } from './DesignLibraryHost';

const chunk = vi.hoisted(() => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve(), requested: vi.fn() };
});

vi.mock('./DesignLibraryDialog', async () => {
  chunk.requested();
  await chunk.promise;
  return {
    DesignLibraryContents: () => (
      <button type="button" onClick={() => useUiStore.getState().setLibraryDialogOpen(false)}>
        Loaded library
      </button>
    ),
  };
});

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  useUiStore.setState({ libraryDialogOpen: false, modalDepth: 0 });
  vi.unstubAllGlobals();
});

async function openLibrary(): Promise<void> {
  await act(async () => useUiStore.getState().setLibraryDialogOpen(true));
}

function libraryDialog(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog === null) throw new Error('Library dialog missing');
  return dialog;
}

it('loads only on open and keeps one dismissible modal through deferred loading', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useUiStore.setState({ libraryDialogOpen: false, modalDepth: 0 });
  const opener = document.createElement('button');
  const host = document.createElement('div');
  document.body.append(opener, host);
  opener.focus();
  await act(async () => {
    root = createRoot(host);
    root.render(<DesignLibraryHost />);
  });
  expect(chunk.requested).not.toHaveBeenCalled();
  expect(host.childElementCount).toBe(0);

  await openLibrary();
  await vi.waitFor(() => expect(chunk.requested).toHaveBeenCalledOnce());
  expect(libraryDialog().getAttribute('aria-modal')).toBe('true');
  expect(libraryDialog().textContent).toContain('Opening Design Library');
  expect(useUiStore.getState().modalDepth).toBe(1);
  await act(async () => {
    libraryDialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(useUiStore.getState().libraryDialogOpen).toBe(false);
  expect(useUiStore.getState().modalDepth).toBe(0);
  expect(document.activeElement).toBe(opener);

  await openLibrary();
  const shell = libraryDialog();
  await act(async () => {
    chunk.resolve();
    await chunk.promise;
  });
  await vi.waitFor(async () => {
    await act(async () => Promise.resolve());
    expect(shell.textContent).toContain('Loaded library');
  });
  expect(libraryDialog()).toBe(shell);
  expect(useUiStore.getState().modalDepth).toBe(1);
  await act(async () => shell.querySelector<HTMLButtonElement>('button')?.click());
  expect(useUiStore.getState().modalDepth).toBe(0);
  expect(document.activeElement).toBe(opener);

  await openLibrary();
  expect(libraryDialog().textContent).toContain('Loaded library');
  expect(chunk.requested).toHaveBeenCalledOnce();
});
