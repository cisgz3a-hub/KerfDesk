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

describe('CutsLayersPanel layer order controls', () => {
  it('moves a layer up through the Cuts / Layers panel', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff', '#00ff00']));
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<CutsLayersPanel />);
      });

      const moveBlueUp = host.querySelector('button[aria-label="Move #0000ff up"]');
      if (!(moveBlueUp instanceof HTMLButtonElement)) throw new Error('move button missing');

      await act(async () => {
        moveBlueUp.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(useStore.getState().project.scene.layers.map((layer) => layer.id)).toEqual([
        '#0000ff',
        '#ff0000',
        '#00ff00',
      ]);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('disables boundary layer move buttons', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000', '#0000ff']));
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<CutsLayersPanel />);
      });

      const topUp = host.querySelector('button[aria-label="Move #ff0000 up"]');
      const bottomDown = host.querySelector('button[aria-label="Move #0000ff down"]');
      if (!(topUp instanceof HTMLButtonElement)) throw new Error('top move button missing');
      if (!(bottomDown instanceof HTMLButtonElement)) throw new Error('bottom move button missing');

      expect(topUp.disabled).toBe(true);
      expect(bottomDown.disabled).toBe(true);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
