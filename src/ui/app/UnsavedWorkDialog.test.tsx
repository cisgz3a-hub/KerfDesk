import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addLayer, addObject, createLayer, createProject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { projectAutosaveService, type AutosaveDurableSnapshot } from '../state/autosave-durable';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { UnsavedWorkDialog } from './UnsavedWorkDialog';
import { useUnsavedWorkStore } from './unsaved-work-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const platform: PlatformAdapter = {
  id: 'web',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

function snapshot(id: string, minutesAgo: number): AutosaveDurableSnapshot {
  const project = createProject();
  return {
    project: {
      ...project,
      scene: addObject(
        addLayer(project.scene, createLayer({ id: '#000000', color: '#000000' })),
        svgObj(id, ['#000000']),
      ),
    },
    savedAt: Date.now() - minutesAgo * 60_000,
    storageKey: `slot-${id}`,
    sessionId: `session-${id}`,
    backend: 'indexeddb',
    ownership: 'abandoned',
  };
}

beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useUnsavedWorkStore.setState({ open: false });
  useUiStore.setState({ modalDepth: 0 });
  vi.restoreAllMocks();
  resetStore();
});

describe('File > Recover unsaved work (ADR-688)', () => {
  it('lists earlier sessions newest first and restores the one chosen', async () => {
    const newer = snapshot('second-design', 5);
    const older = snapshot('first-design', 90);
    const write = vi.spyOn(projectAutosaveService, 'write').mockResolvedValue({
      kind: 'ok',
      savedAt: Date.now(),
      storageKey: 'current-window-autosave',
      backend: 'indexeddb',
    });
    const clearRecovered = vi
      .spyOn(projectAutosaveService, 'clearRecovered')
      .mockResolvedValue({ kind: 'ok' });
    useUnsavedWorkStore.getState().openDialog();

    await act(async () =>
      root.render(
        <UnsavedWorkDialog
          platform={platform}
          source={{ readRecent: async () => [newer, older] }}
        />,
      ),
    );

    const rows = [...host.querySelectorAll('[data-unsaved-work]')];
    expect(rows.map((row) => row.getAttribute('data-unsaved-work'))).toEqual([
      'slot-second-design',
      'slot-first-design',
    ]);
    expect(rows[1]?.textContent).toContain('1 object');
    expect(rows[1]?.textContent).toContain('90 minutes ago');

    const restore = rows[1]?.querySelector('button');
    await act(async () => restore?.click());
    await act(async () => undefined);

    expect(useUnsavedWorkStore.getState().open).toBe(false);
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'first-design',
    ]);
    expect(useStore.getState().dirty).toBe(true);
    expect(write).toHaveBeenCalledExactlyOnceWith(older.project);
    expect(clearRecovered).toHaveBeenCalledExactlyOnceWith(older, 'current-window-autosave');
  });

  it('says so when no earlier session left unsaved work', async () => {
    await act(async () =>
      root.render(
        <UnsavedWorkDialog platform={platform} source={{ readRecent: async () => [] }} />,
      ),
    );

    expect(host.ownerDocument.body.textContent).toContain('No unsaved work from earlier sessions.');
  });
});
