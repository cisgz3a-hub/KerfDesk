import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { mockPlatform, projectWithLine } from '../../__fixtures__/file-actions';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { createLocalSnapshotStorage } from './local-snapshot-storage';
import { LocalProjectSnapshots } from './LocalProjectSnapshots';

it('makes applied operator notes undoable and shows them with the latest persistent copy', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resetStore();
  useStore.getState().setProject(projectWithLine());
  const host = document.createElement('div');
  const root = createRoot(host);
  const storage = createLocalSnapshotStorage(new FakeIDBFactory());
  const button = (label: string): HTMLButtonElement => {
    const found = [...host.querySelectorAll('button')].find((node) => node.textContent === label);
    if (found === undefined) throw new Error(`missing ${label}`);
    return found;
  };
  try {
    await act(async () =>
      root.render(
        <LocalProjectSnapshots platform={mockPlatform()} storage={storage} onRestored={vi.fn()} />,
      ),
    );
    const notes = host.querySelector<HTMLTextAreaElement>(
      '[aria-label="Current project operator notes"]',
    )!;
    await act(async () => {
      notes.value = 'Use copper sample; lower power next';
      Simulate.change(notes);
    });
    await act(async () => button('Apply notes').click());
    expect(useStore.getState().project.notes).toBe('Use copper sample; lower power next');
    expect(useStore.getState().undoStack.length).toBeGreaterThan(0);
    const name = host.querySelector<HTMLInputElement>('[aria-label="Local snapshot name"]')!;
    await act(async () => {
      name.value = 'Copper pass 1';
      Simulate.change(name);
    });
    await act(async () => button('Save local snapshot').click());
    await vi.waitFor(async () => {
      await act(async () => {
        await Promise.resolve();
      });
      expect(host.textContent).toContain('Latest local copy');
    });
    expect(host.textContent).toContain('Use copper sample; lower power next');
    expect(await storage.list()).toHaveLength(1);
    expect(host.textContent).toContain('Resume as new project');
    await act(async () => button('Remove snapshot').click());
    await vi.waitFor(async () => {
      await act(async () => {
        await Promise.resolve();
      });
      expect(host.textContent).toContain('No named local snapshots yet');
    });
    expect(useStore.getState().project.notes).toBe('Use copper sample; lower power next');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('preserves the next snapshot name typed while a save is pending', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resetStore();
  useStore.getState().setProject(projectWithLine());
  const persisted = createLocalSnapshotStorage(new FakeIDBFactory());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const add = vi.fn(async (snapshot: Parameters<typeof persisted.add>[0]) => {
    await gate;
    await persisted.add(snapshot);
  });
  const storage = { ...persisted, add };
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <LocalProjectSnapshots platform={mockPlatform()} storage={storage} onRestored={vi.fn()} />,
      ),
    );
    const name = host.querySelector<HTMLInputElement>('[aria-label="Local snapshot name"]')!;
    await act(async () => {
      name.value = 'First layout';
      Simulate.change(name);
    });
    const save = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save local snapshot',
    )!;
    await act(async () => save.click());
    await vi.waitFor(() => expect(add).toHaveBeenCalledOnce());
    await act(async () => {
      name.value = 'Next layout';
      Simulate.change(name);
    });
    await act(async () => {
      release();
      await gate;
    });
    await vi.waitFor(async () => {
      await act(async () => Promise.resolve());
      expect(host.textContent).toContain('Latest local copy');
    });
    expect(name.value).toBe('Next layout');
    expect((await persisted.list())[0]?.name).toBe('First layout');
  } finally {
    release();
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
