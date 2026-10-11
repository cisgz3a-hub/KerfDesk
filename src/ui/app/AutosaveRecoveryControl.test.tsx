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
import { AutosaveRecoveryControl } from './AutosaveRecoveryControl';

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

async function mountControl(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <StrictMode>
        <AutosaveRecoveryControl />
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

function controls(): NodeListOf<HTMLElement> | undefined {
  return host?.querySelectorAll('[aria-label="Recover autosave"]');
}

beforeEach(resetStore);

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
  resetStore();
});

describe('AutosaveRecoveryControl', () => {
  it('offers one nonblocking recovery choice in StrictMode without stealing focus', async () => {
    const service = mockRecovery();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const editorInput = document.createElement('input');
    document.body.appendChild(editorInput);
    editorInput.focus();
    try {
      await mountControl();

      expect(controls()).toHaveLength(1);
      expect(button('Recover autosave').getAttribute('aria-expanded')).toBe('false');
      expect(document.querySelector('[role="dialog"], [aria-modal="true"]')).toBeNull();
      expect(document.activeElement).toBe(editorInput);
      expect(confirm).not.toHaveBeenCalled();
      expect(service.write).not.toHaveBeenCalled();
      expect(service.clearRecovered).not.toHaveBeenCalled();
    } finally {
      editorInput.remove();
    }
  });

  it('restores only on request and preserves a dirty durable copy before clearing its source', async () => {
    const service = mockRecovery();
    await mountControl();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);

    await act(async () => button('Recover autosave').click());
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
    expect(controls()).toHaveLength(0);
  });

  it('closes with Escape and returns focus without dismissing the recovery offer', async () => {
    const service = mockRecovery();
    await mountControl();
    const trigger = button('Recover autosave');
    await act(async () => trigger.click());
    expect(document.activeElement).toBe(button('Restore'));
    const panel = document.querySelector('[role="dialog"][aria-label="Autosaved project"]');
    expect(panel).not.toBeNull();
    await act(async () => {
      panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(service.write).not.toHaveBeenCalled();
    expect(service.clearRecovered).not.toHaveBeenCalled();
    await act(async () => trigger.click());
    expect(button('Restore')).toBeDefined();
  });

  it('closes when the trigger is clicked again after focus returns from the panel', async () => {
    mockRecovery();
    await mountControl();
    const trigger = button('Recover autosave');
    await act(async () => trigger.click());
    expect(document.activeElement).toBe(button('Restore'));
    await act(async () => trigger.focus());
    await act(async () => trigger.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when keyboard focus leaves through the trigger and retains the backup', async () => {
    const service = mockRecovery();
    await mountControl();
    const trigger = button('Recover autosave');
    await act(async () => trigger.click());
    await act(async () => trigger.focus());
    const next = document.createElement('button');
    document.body.appendChild(next);
    try {
      await act(async () => next.focus());
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(controls()).toHaveLength(1);
      expect(service.write).not.toHaveBeenCalled();
      expect(service.clearRecovered).not.toHaveBeenCalled();
    } finally {
      next.remove();
    }
  });

  it('hides the choice without discarding or rewriting the backup', async () => {
    const service = mockRecovery();
    await mountControl();

    await act(async () => button('Recover autosave').click());
    await act(async () => button('Hide').click());
    await act(async () => useStore.getState().setCursorMm({ x: 5, y: 10 }));

    expect(controls()).toHaveLength(0);
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
    expect(service.write).not.toHaveBeenCalled();
    expect(service.clearRecovered).not.toHaveBeenCalled();
  });

  it.each([
    ['editing', () => useStore.getState().setProjectNotes('My current work')],
    ['opening an empty project', () => useStore.getState().setProject(createProject())],
    ['New Project', () => useStore.getState().newProject()],
  ] as const)(
    'withdraws recovery after %s and cannot replace the current project',
    async (_, change) => {
      const service = mockRecovery();
      await mountControl();
      await act(async () => button('Recover autosave').click());
      const restore = button('Restore');

      await act(async () => {
        change();
        // The user can change document state before React removes the old button.
        restore.click();
      });

      expect(controls()).toHaveLength(0);
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
    await mountControl();

    await act(async () => {
      useStore.getState().newProject();
      resolveRead({ snapshot: service.snapshot, warnings: [], unreadable: [] });
    });

    expect(controls()).toHaveLength(0);
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(service.write).not.toHaveBeenCalled();
    expect(service.clearRecovered).not.toHaveBeenCalled();
  });
});
