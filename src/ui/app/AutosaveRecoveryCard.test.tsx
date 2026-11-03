import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addLayer, addObject, createLayer, createProject } from '../../core/scene';
import { useStore } from '../state';
import {
  projectAutosaveService,
  type AutosaveDurableReadResult,
  type AutosaveDurableSnapshot,
} from '../state/autosave-durable';
import { resetStore, svgObj } from '../state/test-helpers';
import { AutosaveRecoveryCard } from './AutosaveRecoveryCard';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function recoverySnapshot(): AutosaveDurableSnapshot {
  const project = createProject();
  return {
    project: {
      ...project,
      scene: addObject(
        addLayer(project.scene, createLayer({ id: '#000000', color: '#000000' })),
        svgObj('recovered-artwork', ['#000000']),
      ),
    },
    savedAt: Date.now() - 196 * 60_000,
    storageKey: 'abandoned-autosave',
    sessionId: 'abandoned-window',
    backend: 'indexeddb',
    ownership: 'abandoned',
  };
}

function mockRecovery(snapshot = recoverySnapshot()) {
  const readLatest = vi
    .spyOn(projectAutosaveService, 'readLatest')
    .mockResolvedValue({ snapshot, warnings: [], unreadable: [] });
  const write = vi.spyOn(projectAutosaveService, 'write').mockResolvedValue({
    kind: 'ok',
    savedAt: Date.now(),
    storageKey: 'current-window-autosave',
    backend: 'indexeddb',
  });
  const clearRecovered = vi
    .spyOn(projectAutosaveService, 'clearRecovered')
    .mockResolvedValue({ kind: 'ok' });
  return { snapshot, readLatest, write, clearRecovered };
}

async function mountCard(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <StrictMode>
        <AutosaveRecoveryCard />
      </StrictMode>,
    );
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...(document.querySelectorAll('button') ?? [])].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(match, `Expected a ${label} button`).toBeDefined();
  return match as HTMLButtonElement;
}

function cards(): NodeListOf<HTMLElement> | undefined {
  return host?.querySelectorAll('[data-autosave-recovery-card]');
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
  localStorage.clear();
  resetStore();
});

describe('AutosaveRecoveryCard (ADR-686)', () => {
  it('asks on the canvas whether to restore the last session, without stealing focus', async () => {
    const service = mockRecovery();
    const editorInput = document.createElement('input');
    document.body.appendChild(editorInput);
    editorInput.focus();
    try {
      await mountCard();

      expect(cards()).toHaveLength(1);
      const card = cards()?.[0];
      expect(card?.querySelector('h2')?.textContent).toBe(
        "Your last session wasn't saved. Restore it?",
      );
      expect(card?.textContent).toContain('1 object, autosaved 196 minutes ago in this browser.');
      expect(card?.textContent).toContain('File > Recover unsaved work');
      expect(button('Restore')).toBeDefined();
      expect(button('Start fresh')).toBeDefined();
      expect(document.querySelector('[aria-modal="true"]')).toBeNull();
      expect(document.activeElement).toBe(editorInput);
      expect(service.write).not.toHaveBeenCalled();
      expect(service.clearRecovered).not.toHaveBeenCalled();
    } finally {
      editorInput.remove();
    }
  });

  it('restores on request and preserves a dirty durable copy before clearing its source', async () => {
    const service = mockRecovery();
    await mountCard();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);

    await act(async () => button('Restore').click());

    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'recovered-artwork',
    ]);
    expect(useStore.getState().dirty).toBe(true);
    expect(service.write).toHaveBeenCalledExactlyOnceWith(service.snapshot.project);
    expect(service.clearRecovered).toHaveBeenCalledExactlyOnceWith(
      service.snapshot,
      'current-window-autosave',
    );
    expect(service.write.mock.invocationCallOrder[0]).toBeLessThan(
      service.clearRecovered.mock.invocationCallOrder[0]!,
    );
    expect(cards()).toHaveLength(0);
  });

  it('starts fresh without discarding or rewriting the autosave, and does not ask about it again', async () => {
    const service = mockRecovery();
    await mountCard();

    await act(async () => button('Start fresh').click());
    await act(async () => useStore.getState().setCursorMm({ x: 5, y: 10 }));

    expect(cards()).toHaveLength(0);
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
    expect(service.write).not.toHaveBeenCalled();
    expect(service.clearRecovered).not.toHaveBeenCalled();

    // The next launch finds the same snapshot: File > Recover unsaved work
    // still lists it, but the card does not ask again.
    await act(async () => root?.unmount());
    host?.remove();
    await mountCard();
    expect(cards()).toHaveLength(0);
    expect(service.clearRecovered).not.toHaveBeenCalled();
  });

  it('still asks about newer unsaved work after an earlier Start fresh', async () => {
    const service = mockRecovery();
    await mountCard();
    await act(async () => button('Start fresh').click());
    await act(async () => root?.unmount());
    host?.remove();

    service.readLatest.mockResolvedValue({
      snapshot: { ...service.snapshot, savedAt: Date.now() - 60_000 },
      warnings: [],
      unreadable: [],
    });
    await mountCard();
    expect(cards()).toHaveLength(1);
  });

  it.each([
    ['editing', () => useStore.getState().setProjectNotes('My current work')],
    ['opening an empty project', () => useStore.getState().setProject(createProject())],
    ['New Project', () => useStore.getState().newProject()],
  ] as const)(
    'withdraws the card after %s and cannot replace the current project',
    async (_, change) => {
      const service = mockRecovery();
      await mountCard();
      const restore = button('Restore');

      await act(async () => {
        change();
        // The user can change document state before React removes the old button.
        restore.click();
      });

      expect(cards()).toHaveLength(0);
      expect(useStore.getState().project.scene.objects).toHaveLength(0);
      expect(service.write).not.toHaveBeenCalled();
      expect(service.clearRecovered).not.toHaveBeenCalled();
    },
  );

  it('does not offer a delayed autosave read after New Project', async () => {
    const service = mockRecovery();
    let resolveRead: (value: AutosaveDurableReadResult) => void = () => undefined;
    const pendingRead = new Promise<AutosaveDurableReadResult>((resolve) => {
      resolveRead = resolve;
    });
    service.readLatest.mockReturnValue(pendingRead);
    await mountCard();

    await act(async () => {
      useStore.getState().newProject();
      resolveRead({ snapshot: service.snapshot, warnings: [], unreadable: [] });
    });

    expect(cards()).toHaveLength(0);
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(service.write).not.toHaveBeenCalled();
    expect(service.clearRecovered).not.toHaveBeenCalled();
  });
});
