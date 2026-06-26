import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { SelectedObjectProperties } from './SelectedObjectProperties';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
});

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<SelectedObjectProperties />);
  });
  return { host, root };
}

describe('SelectedObjectProperties', () => {
  it('does not render when nothing is selected', async () => {
    const { host, root } = await render();
    try {
      expect(host.querySelector('[aria-label="Selected object properties"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('shows default power scale for one selected object', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    const { host, root } = await render();
    try {
      const input = host.querySelector('input[aria-label="Power scale for selected objects"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('power scale input missing');
      expect(input.value).toBe('100');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('commits power scale edits to the selected object on blur', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    const { host, root } = await render();
    try {
      const input = host.querySelector('input[aria-label="Power scale for selected objects"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('power scale input missing');
      await act(async () => {
        input.value = '50';
        Simulate.change(input);
      });
      await act(async () => {
        Simulate.blur(input);
      });

      expect(useStore.getState().project.scene.objects[0]?.powerScale).toBe(50);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('edits operation settings only on the selected object', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#000000']));
    useStore.getState().selectObject('O2');
    const { host, root } = await render();
    try {
      const mode = host.querySelector('select[aria-label="Mode for selected objects"]');
      if (!(mode instanceof HTMLSelectElement)) throw new Error('selected mode control missing');
      await act(async () => {
        mode.value = 'fill';
        Simulate.change(mode);
      });

      const state = useStore.getState();
      expect(state.project.scene.layers.find((layer) => layer.color === '#000000')?.mode).toBe(
        'line',
      );
      expect(state.project.scene.objects.map((object) => object.operationOverride)).toEqual([
        undefined,
        { mode: 'fill' },
      ]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
