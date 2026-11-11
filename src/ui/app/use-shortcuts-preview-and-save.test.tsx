// Annoyance audit A4-P2-5 and A4-P2-6, through the real window listeners:
//   * in Preview a key that would change artwork changes nothing and says why;
//   * Ctrl+S is always consumed while a dialog, a Studio or canvas text owns
//     the keyboard, with one line saying what to do first.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { PREVIEW_EDIT_HINT } from '../state/preview-edit-hint';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { useCanvasTextStore } from '../text/canvas-text-store';
import { PlatformProvider } from './platform-context';
import { SAVE_BLOCKED_MESSAGES } from './save-shortcut-when-owned';
import { useShortcuts } from './use-shortcuts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: {
    isSupported: () => false,
    requestPort: vi.fn(async () => null),
  },
};

function ShortcutHarness(): null {
  useShortcuts();
  return null;
}

function installVectorProject(): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        layers: [createLayer({ id: '#ff0000', color: '#ff0000', mode: 'line' })],
        objects: [
          {
            kind: 'imported-svg',
            id: 'vec-1',
            source: 'logo.svg',
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: 0, y: 0 },
                      { x: 10, y: 0 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    selectedObjectId: 'vec-1',
    additionalSelectedIds: new Set(),
  });
}

async function renderHarness(): Promise<() => Promise<void>> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <ShortcutHarness />
      </PlatformProvider>,
    );
  });
  return async () => {
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
  };
}

async function pressKey(
  init: KeyboardEventInit & { readonly key: string },
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    document.body.dispatchEvent(event);
    await Promise.resolve();
    await Promise.resolve();
  });
  return event;
}

function toastMessages(): ReadonlyArray<string> {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

afterEach(() => {
  useCanvasTextStore.getState().close();
  document.querySelector('[aria-label="Design Studio"]')?.remove();
  useStore.getState().newProject();
  if (useStore.getState().previewMode) useStore.getState().togglePreview();
  useUiStore.getState().resetToolMode();
  useUiStore.setState({ textDialog: null, imageDialog: null, modalDepth: 0 });
  useToastStore.setState({ toasts: [] });
  vi.clearAllMocks();
});

describe('editing keys in Preview (A4-P2-5)', () => {
  it('leaves the artwork alone and says why, once', async () => {
    installVectorProject();
    useStore.getState().copySelection();
    useStore.getState().togglePreview();
    const before = useStore.getState().project;
    const unmount = await renderHarness();
    try {
      const pressed = [
        await pressKey({ key: 'Delete' }),
        await pressKey({ key: 'Backspace' }),
        await pressKey({ key: 'x', ctrlKey: true }),
        await pressKey({ key: 'v', ctrlKey: true }),
        await pressKey({ key: 'd', ctrlKey: true }),
        await pressKey({ key: 'g', ctrlKey: true }),
        await pressKey({ key: 'ArrowRight' }),
        await pressKey({ key: 'ArrowUp', shiftKey: true }),
        await pressKey({ key: 'h' }),
        await pressKey({ key: 'v' }),
        await pressKey({ key: '.' }),
        await pressKey({ key: 'v', altKey: true }),
        await pressKey({ key: 'PageUp' }),
      ];
      expect(useStore.getState().project).toBe(before);
      expect(useStore.getState().selectedObjectId).toBe('vec-1');
      // Each key is still consumed: Ctrl+D must not reach the browser's bookmark.
      expect(pressed.map((event) => event.defaultPrevented)).toEqual(pressed.map(() => true));
      expect(toastMessages()).toEqual([PREVIEW_EDIT_HINT]);
    } finally {
      await unmount();
    }
  });

  it('does not arm a drawing tool the canvas would ignore', async () => {
    installVectorProject();
    useStore.getState().togglePreview();
    const unmount = await renderHarness();
    try {
      await pressKey({ key: 't' });
      await pressKey({ key: 'r', ctrlKey: true });
      expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
      expect(toastMessages()).toEqual([PREVIEW_EDIT_HINT]);
    } finally {
      await unmount();
    }
  });

  it('keeps Undo, Copy, Select All and P, and edits again after leaving Preview', async () => {
    installVectorProject();
    useStore.getState().duplicateSelection();
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    useStore.getState().togglePreview();
    const unmount = await renderHarness();
    try {
      await pressKey({ key: 'z', ctrlKey: true });
      expect(useStore.getState().project.scene.objects).toHaveLength(1);
      await pressKey({ key: 'a', ctrlKey: true });
      await pressKey({ key: 'c', ctrlKey: true });
      expect(useStore.getState().sceneClipboard?.objects).toHaveLength(1);
      expect(toastMessages()).toEqual([]);

      await pressKey({ key: 'p' });
      expect(useStore.getState().previewMode).toBe(false);
      await pressKey({ key: 'Delete' });
      expect(useStore.getState().project.scene.objects).toHaveLength(0);
    } finally {
      await unmount();
    }
  });
});

describe('Ctrl+S while something else owns the keyboard (A4-P2-6)', () => {
  it('is consumed inside a dialog and saves nothing', async () => {
    installVectorProject();
    useUiStore.setState({ modalDepth: 1 });
    const unmount = await renderHarness();
    try {
      const save = await pressKey({ key: 's', ctrlKey: true });
      const saveAs = await pressKey({ key: 'S', ctrlKey: true, shiftKey: true });
      const mac = await pressKey({ key: 's', metaKey: true });
      expect([save.defaultPrevented, saveAs.defaultPrevented, mac.defaultPrevented]).toEqual([
        true,
        true,
        true,
      ]);
      expect(mockPlatform.pickFileForSave).not.toHaveBeenCalled();
      expect(toastMessages()).toEqual([SAVE_BLOCKED_MESSAGES.dialog]);
    } finally {
      await unmount();
    }
  });

  it('is consumed even when the dialog stops the key from bubbling', async () => {
    installVectorProject();
    useUiStore.setState({ modalDepth: 1 });
    const field = document.createElement('input');
    field.addEventListener('keydown', (event) => event.stopPropagation());
    document.body.appendChild(field);
    const unmount = await renderHarness();
    try {
      const save = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        field.dispatchEvent(save);
      });
      expect(save.defaultPrevented).toBe(true);
    } finally {
      field.remove();
      await unmount();
    }
  });

  it('tells a Design Studio user to apply the drawing first', async () => {
    installVectorProject();
    useUiStore.setState({ modalDepth: 1 });
    // The Studio overlay as DesignStudioOverlay renders it.
    const studio = document.createElement('div');
    studio.setAttribute('role', 'dialog');
    studio.setAttribute('aria-label', 'Design Studio');
    document.body.appendChild(studio);
    const before = useStore.getState().project;
    const unmount = await renderHarness();
    try {
      const save = await pressKey({ key: 's', ctrlKey: true });
      expect(save.defaultPrevented).toBe(true);
      expect(toastMessages()).toEqual([SAVE_BLOCKED_MESSAGES.designStudio]);
      expect(useStore.getState().project).toBe(before);
      expect(mockPlatform.pickFileForSave).not.toHaveBeenCalled();
    } finally {
      await unmount();
    }
  });

  it('tells a canvas text user to finish the text first', async () => {
    installVectorProject();
    useCanvasTextStore.getState().beginAdd({ x: 30, y: 40 });
    const unmount = await renderHarness();
    try {
      const save = await pressKey({ key: 's', ctrlKey: true });
      expect(save.defaultPrevented).toBe(true);
      expect(toastMessages()).toEqual([SAVE_BLOCKED_MESSAGES.canvasText]);
    } finally {
      await unmount();
    }
  });

  it('leaves other keys in a dialog to the dialog', async () => {
    installVectorProject();
    useUiStore.setState({ modalDepth: 1 });
    const unmount = await renderHarness();
    try {
      const open = await pressKey({ key: 'o', ctrlKey: true });
      const plain = await pressKey({ key: 's' });
      const altGr = await pressKey({ key: 's', ctrlKey: true, altKey: true });
      expect([open.defaultPrevented, plain.defaultPrevented, altGr.defaultPrevented]).toEqual([
        false,
        false,
        false,
      ]);
      expect(toastMessages()).toEqual([]);
    } finally {
      await unmount();
    }
  });
});
