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

  it('keeps one canvas across new surfaces and replaces it only after a failure', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const ok = async () => ({ kind: 'ok' as const, handle: { dispose: () => undefined } });
    const failed = async () => ({ kind: 'no-webgl' as const, reason: 'context lost' });
    const render = (
      buildScene: Parameters<typeof Viewer3DDialogShell>[0]['buildScene'],
      updating = false,
    ) => (
      <Viewer3DDialogShell
        ariaLabel="Test 3D viewer"
        canvasAriaLabel="Test 3D surface"
        title="Test surface"
        onClose={() => undefined}
        buildScene={buildScene}
        updating={updating}
      />
    );
    const root = createRoot(host);
    try {
      await act(async () => root.render(render(vi.fn(ok))));
      const first = host.querySelector('canvas');
      await act(async () => root.render(render(vi.fn(ok), true)));
      expect(host.querySelector('canvas')).toBe(first);
      expect(first?.getAttribute('aria-busy')).toBe('true');
      expect(host.textContent).toContain('Updating the 3D surface');

      await act(async () => root.render(render(vi.fn(failed))));
      await act(async () => Promise.resolve());
      expect(host.textContent).toContain('3D view unavailable: context lost');
      expect(host.querySelector('canvas')).toBe(first);

      await act(async () => root.render(render(vi.fn(ok))));
      expect(host.querySelector('canvas')).not.toBe(first);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
