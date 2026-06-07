import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
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

describe('CutsLayersPanel cut settings editor', () => {
  it('opens a staged editor and applies changes only after OK', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<CutsLayersPanel />);
      });

      const edit = host.querySelector('button[aria-label="Edit cut settings for #ff0000"]');
      if (!(edit instanceof HTMLButtonElement)) throw new Error('edit button missing');
      await act(async () => {
        edit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const power = host.querySelector('input[aria-label="Cut settings power"]');
      const speed = host.querySelector('input[aria-label="Cut settings speed"]');
      if (!(power instanceof HTMLInputElement)) throw new Error('power input missing');
      if (!(speed instanceof HTMLInputElement)) throw new Error('speed input missing');

      await act(async () => {
        power.value = '42';
        power.dispatchEvent(new Event('input', { bubbles: true }));
        speed.value = '1777';
        speed.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(useStore.getState().project.scene.layers[0]?.power).toBe(30);

      const ok = [...host.querySelectorAll('button')].find((button) => button.textContent === 'OK');
      if (!(ok instanceof HTMLButtonElement)) throw new Error('OK button missing');
      await act(async () => {
        ok.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const layer = useStore.getState().project.scene.layers[0];
      expect(layer?.power).toBe(42);
      expect(layer?.speed).toBe(1777);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('cancels staged cut setting edits without mutating the layer', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<CutsLayersPanel />);
      });

      const edit = host.querySelector('button[aria-label="Edit cut settings for #ff0000"]');
      if (!(edit instanceof HTMLButtonElement)) throw new Error('edit button missing');
      await act(async () => {
        edit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const speed = host.querySelector('input[aria-label="Cut settings speed"]');
      if (!(speed instanceof HTMLInputElement)) throw new Error('speed input missing');
      await act(async () => {
        speed.value = '999';
        speed.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const cancel = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Cancel',
      );
      if (!(cancel instanceof HTMLButtonElement)) throw new Error('Cancel button missing');
      await act(async () => {
        cancel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(useStore.getState().project.scene.layers[0]?.speed).toBe(1500);
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('applies image toggles from the staged image editor', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setLayerParam('#ff0000', { mode: 'image' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<CutsLayersPanel />);
      });

      const edit = host.querySelector('button[aria-label="Edit cut settings for #ff0000"]');
      if (!(edit instanceof HTMLButtonElement)) throw new Error('edit button missing');
      await act(async () => {
        edit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const negative = host.querySelector('input[name="negativeImage"]');
      if (!(negative instanceof HTMLInputElement)) throw new Error('negative image input missing');
      negative.checked = true;
      const passThrough = host.querySelector('input[name="passThrough"]');
      if (!(passThrough instanceof HTMLInputElement)) throw new Error('pass-through input missing');
      passThrough.checked = true;
      const dotWidth = host.querySelector('input[name="dotWidthCorrectionMm"]');
      if (!(dotWidth instanceof HTMLInputElement)) throw new Error('dot width input missing');
      dotWidth.value = '0.08';

      const ok = [...host.querySelectorAll('button')].find((button) => button.textContent === 'OK');
      if (!(ok instanceof HTMLButtonElement)) throw new Error('OK button missing');
      await act(async () => {
        ok.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const layer = useStore.getState().project.scene.layers[0];
      expect((layer as { readonly negativeImage?: boolean })?.negativeImage).toBe(true);
      expect((layer as { readonly passThrough?: boolean })?.passThrough).toBe(true);
      expect((layer as { readonly dotWidthCorrectionMm?: number })?.dotWidthCorrectionMm).toBe(
        0.08,
      );
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('applies image toggles from the visible image layer row', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setLayerParam('#ff0000', { mode: 'image' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<CutsLayersPanel />);
      });

      const negative = host.querySelector('input[aria-label="Negative image for #ff0000"]');
      if (!(negative instanceof HTMLInputElement)) throw new Error('negative image input missing');
      const passThrough = host.querySelector('input[aria-label="Pass-through image for #ff0000"]');
      if (!(passThrough instanceof HTMLInputElement)) throw new Error('pass-through input missing');
      const dotWidth = host.querySelector('input[aria-label="Dot width correction for #ff0000"]');
      if (!(dotWidth instanceof HTMLInputElement)) throw new Error('dot width input missing');

      await act(async () => {
        negative.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        passThrough.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await act(async () => {
        dotWidth.value = '0.07';
        Simulate.change(dotWidth);
      });

      await act(async () => {
        Simulate.blur(dotWidth);
      });

      const layer = useStore.getState().project.scene.layers[0];
      expect((layer as { readonly negativeImage?: boolean })?.negativeImage).toBe(true);
      expect((layer as { readonly passThrough?: boolean })?.passThrough).toBe(true);
      expect((layer as { readonly dotWidthCorrectionMm?: number })?.dotWidthCorrectionMm).toBe(
        0.07,
      );
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
