import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { CutsLayersPanel } from './CutsLayersPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
});

describe('LayerRow double-click cut settings', () => {
  it('opens the cut settings dialog by double-clicking a layer entry', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<CutsLayersPanel />);
      });

      const row = host.querySelector('section[aria-label="Layer #ff0000"]');
      if (!(row instanceof HTMLElement)) throw new Error('layer row missing');
      await act(async () => {
        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });

      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('does not open cut settings when double-clicking an interactive layer control', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<CutsLayersPanel />);
      });

      const mode = host.querySelector('select[aria-label="Mode for #ff0000"]');
      if (!(mode instanceof HTMLSelectElement)) throw new Error('mode select missing');
      await act(async () => {
        mode.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });

      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('does not open cut settings when double-clicking an interactive layer label', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<CutsLayersPanel />);
      });

      const showToggle = Array.from(host.querySelectorAll('label')).find((label) =>
        label.textContent?.includes('Show'),
      );
      if (!(showToggle instanceof HTMLLabelElement)) throw new Error('show label missing');
      await act(async () => {
        showToggle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });

      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
