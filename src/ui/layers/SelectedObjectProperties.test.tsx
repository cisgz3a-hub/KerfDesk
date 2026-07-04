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

  it('renders nothing in CNC mode — every editor here is laser-only (ADR-101 §3)', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    useStore.getState().setMachineKind('cnc');
    const { host, root } = await render();
    try {
      expect(host.querySelector('[aria-label="Selected object properties"]')).toBeNull();
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

  it('shows mixed selected artwork operation values until a field is edited', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#000000']));
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) =>
            object.id === 'O2'
              ? { ...object, operationOverride: { mode: 'fill' as const, power: 55 } }
              : object,
          ),
        },
      },
      selectedObjectId: 'O1',
      additionalSelectedIds: new Set(['O2']),
    }));

    const { host, root } = await render();
    try {
      expect(host.querySelector('[aria-label="Selected artwork mixed settings"]')).not.toBeNull();

      const mode = host.querySelector('select[aria-label="Mode for selected objects"]');
      if (!(mode instanceof HTMLSelectElement)) throw new Error('selected mode control missing');
      expect(mode.value).toBe('__mixed__');

      const power = host.querySelector('input[aria-label="Power for selected objects"]');
      if (!(power instanceof HTMLInputElement)) throw new Error('selected power control missing');
      expect(power.value).toBe('');
      expect(power.placeholder).toBe('Mixed');

      await act(async () => {
        power.value = '60';
        Simulate.change(power);
      });
      await act(async () => {
        Simulate.blur(power);
      });

      expect(
        useStore.getState().project.scene.objects.map((object) => object.operationOverride),
      ).toEqual([
        { power: 60, minPower: 0 },
        { mode: 'fill', power: 60, minPower: 0 },
      ]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
