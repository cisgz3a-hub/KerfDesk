import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Viewer3DDialogShell } from './Viewer3DDialogShell';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Viewer3DDialogShell', () => {
  it('provides the shared modal contract and keyboard-complete camera instructions', async () => {
    const opener = document.createElement('button');
    const host = document.createElement('div');
    document.body.append(opener, host);
    opener.focus();
    const onClose = vi.fn();
    const dispose = vi.fn();
    const buildScene = vi.fn(async () => ({ kind: 'ok' as const, handle: { dispose } }));
    let root: Root | null = null;

    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <Viewer3DDialogShell
            ariaLabel="Test 3D viewer"
            canvasAriaLabel="Test 3D surface"
            title="Test surface"
            onClose={onClose}
            buildScene={buildScene}
          />,
        );
      });
      await act(async () => {
        await vi.waitFor(() => {
          expect(host.textContent).toContain('Shift+Arrow keys to orbit');
        });
      });

      const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
      const canvas = host.querySelector<HTMLCanvasElement>('canvas');
      const close = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Close',
      );
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
      expect(close).toBeDefined();
      expect(document.activeElement).toBe(close);
      expect(canvas?.tabIndex).toBe(0);
      const descriptionId = canvas?.getAttribute('aria-describedby');
      expect(descriptionId).not.toBeNull();
      expect(document.getElementById(descriptionId ?? '')?.textContent).toContain(
        'Left-drag to pan, right-drag to orbit',
      );

      canvas?.focus();
      await act(async () => {
        canvas?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
      });
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      expect(document.activeElement).toBe(opener);
      host.remove();
      opener.remove();
    }
  });
});
