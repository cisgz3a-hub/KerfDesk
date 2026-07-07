import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { CommandShell } from '../commands';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

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

afterEach(() => {
  useStore.getState().newProject();
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

describe('Toolbar Box Generator', () => {
  it('shows Box Generator in the create tools group and opens the generator dialog', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => canvasRenderingContextStub() as CanvasRenderingContext2D,
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={mockPlatform}>
            <CommandShell />
          </PlatformProvider>,
        );
      });

      const toolbarButtons = [
        ...host.querySelectorAll('header[aria-label="Toolbar"] button'),
      ].filter((button) => button.textContent !== 'Shortcuts');
      const labels = toolbarButtons.map((button) => button.textContent?.trim() ?? '');
      expect(labels).not.toContain('Camera');
      expect(
        labels.slice(labels.indexOf('Registration Jig'), labels.indexOf('Registration Jig') + 2),
      ).toEqual(['Registration Jig', 'Box Generator...']);

      const boxButton = toolbarButtons.find((button) =>
        button.textContent?.includes('Box Generator'),
      );
      if (!(boxButton instanceof HTMLButtonElement))
        throw new Error('Box Generator button missing');
      await act(async () => {
        boxButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const dialog = host.querySelector('[role="dialog"]');
      expect(dialog?.textContent).toContain('Box Generator');
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});

function canvasRenderingContextStub(): Partial<CanvasRenderingContext2D> {
  return {
    beginPath: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
  };
}
