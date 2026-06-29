import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { CommandShell } from '../commands';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { PlatformProvider } from './platform-context';
import { useShortcuts } from './use-shortcuts';
import { Dialog } from '../kit';

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

async function renderHarness(children: JSX.Element = <ShortcutHarness />): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<PlatformProvider adapter={mockPlatform}>{children}</PlatformProvider>);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

async function pressKey(init: KeyboardEventInit & { readonly key: string }): Promise<void> {
  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  useStore.getState().newProject();
  useUiStore.setState({ textDialog: null, imageDialog: null, modalDepth: 0 });
  useToastStore.setState({ toasts: [] });
  vi.clearAllMocks();
});

describe('useShortcuts modal gate', () => {
  it('ignores file and edit shortcuts while the text modal is open', async () => {
    installVectorProject();
    useUiStore.setState({ textDialog: { mode: 'add' } });
    const { unmount } = await renderHarness();
    try {
      await pressKey({ key: 'o', ctrlKey: true });
      await pressKey({ key: 'Backspace' });

      expect(mockPlatform.pickFilesForOpen).not.toHaveBeenCalled();
      expect(useStore.getState().project.scene.objects).toHaveLength(1);
      expect(useStore.getState().selectedObjectId).toBe('vec-1');
    } finally {
      await unmount();
    }
  });

  it('ignores transform and view shortcuts while the text modal is open', async () => {
    installVectorProject();
    useUiStore.setState({ textDialog: { mode: 'add' } });
    const { unmount } = await renderHarness();
    try {
      await pressKey({ key: 'ArrowRight' });
      await pressKey({ key: 'p' });

      const object = useStore.getState().project.scene.objects.find((item) => item.id === 'vec-1');
      expect(object?.transform.x).toBe(0);
      expect(useStore.getState().previewMode).toBe(false);
    } finally {
      await unmount();
    }
  });

  it('ignores edit shortcuts while the convert-to-bitmap modal is open', async () => {
    installVectorProject();
    const { host, unmount } = await renderHarness(
      <>
        <ShortcutHarness />
        <CommandShell />
      </>,
    );
    try {
      const openButton = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Convert to Bitmap'),
      );
      if (!(openButton instanceof HTMLButtonElement)) throw new Error('Convert button missing');
      await act(async () => {
        openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(host.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();

      await pressKey({ key: 'Backspace' });

      expect(useStore.getState().project.scene.objects).toHaveLength(1);
      expect(useStore.getState().selectedObjectId).toBe('vec-1');

      const cancelButton = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Cancel'),
      );
      if (!(cancelButton instanceof HTMLButtonElement)) throw new Error('Cancel button missing');
      await act(async () => {
        cancelButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await pressKey({ key: 'Backspace' });

      expect(useStore.getState().project.scene.objects).toHaveLength(0);
    } finally {
      await unmount();
    }
  });

  it('ignores edit shortcuts while a shared Dialog is open', async () => {
    installVectorProject();
    const { unmount } = await renderHarness(
      <>
        <ShortcutHarness />
        <Dialog onClose={() => undefined} ariaLabel="Shared dialog">
          <button>Inside</button>
        </Dialog>
      </>,
    );
    try {
      await pressKey({ key: 'Backspace' });

      expect(useStore.getState().project.scene.objects).toHaveLength(1);
      expect(useStore.getState().selectedObjectId).toBe('vec-1');
    } finally {
      await unmount();
    }
  });
});
