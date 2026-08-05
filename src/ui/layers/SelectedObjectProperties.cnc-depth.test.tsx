import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS, operationIdsForObject } from '../../core/scene';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { SelectedObjectProperties } from './SelectedObjectProperties';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(resetStore);

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<SelectedObjectProperties />));
  return { host, root };
}

async function cleanup(root: Root, host: HTMLDivElement): Promise<void> {
  await act(async () => root.unmount());
  host.remove();
}

async function change(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}

describe('SelectedObjectProperties CNC multi-selection depth', () => {
  it('bulk-edits mixed depths without unifying independent operations', async () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#000000']));
    const [firstId, secondId] = useStore
      .getState()
      .project.scene.layers.map((operation) => operation.id);
    if (firstId === undefined || secondId === undefined) throw new Error('operations missing');
    useStore.getState().setLayerParam(firstId, {
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'engrave',
        depthMm: 1,
        depthPerPassMm: 0.4,
        feedMmPerMin: 700,
      },
    });
    useStore.getState().setLayerParam(secondId, {
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'pocket',
        depthMm: 2,
        depthPerPassMm: 0.8,
        feedMmPerMin: 900,
      },
    });
    const bindingsBefore = useStore
      .getState()
      .project.scene.objects.map((object) =>
        operationIdsForObject(object, useStore.getState().project.scene.layers),
      );
    useStore.setState({
      selectedObjectId: 'O1',
      additionalSelectedIds: new Set(['O2']),
      undoStack: [],
      redoStack: [],
      dirty: false,
    });

    const { host, root } = await render();
    try {
      const depth = host.querySelector('input[aria-label="Cut depth for selected operations"]');
      if (!(depth instanceof HTMLInputElement)) throw new Error('bulk cut depth input missing');
      expect(depth.disabled).toBe(false);
      expect(depth.value).toBe('');
      expect(depth.placeholder).toBe('Mixed');

      await change(depth, '3.5');
      await act(async () => Simulate.blur(depth));

      const state = useStore.getState();
      expect(state.project.scene.layers.map((operation) => operation.cnc?.depthMm)).toEqual([
        3.5, 3.5,
      ]);
      expect(
        state.project.scene.layers.map((operation) => ({
          cutType: operation.cnc?.cutType,
          depthPerPassMm: operation.cnc?.depthPerPassMm,
          feedMmPerMin: operation.cnc?.feedMmPerMin,
        })),
      ).toEqual([
        { cutType: 'engrave', depthPerPassMm: 0.4, feedMmPerMin: 700 },
        { cutType: 'pocket', depthPerPassMm: 0.8, feedMmPerMin: 900 },
      ]);
      expect(
        state.project.scene.objects.map((object) =>
          operationIdsForObject(object, state.project.scene.layers),
        ),
      ).toEqual(bindingsBefore);
      expect(state.undoStack).toHaveLength(1);

      await act(async () => useStore.getState().undo());
      expect(depth.value).toBe('');
      expect(depth.placeholder).toBe('Mixed');

      await act(async () => useStore.getState().redo());
      expect(depth.value).toBe('3.5');
    } finally {
      await cleanup(root, host);
    }
  });

  it('explains why fixed-depth and V-carve operations cannot share a bulk depth', async () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().importSvgObject(svgObj('Fixed', ['#000000']));
    useStore.getState().importSvgObject(svgObj('Flowing', ['#000000']));
    const flowing = useStore.getState().project.scene.layers[1];
    if (flowing === undefined) throw new Error('flowing operation missing');
    useStore.getState().setLayerParam(flowing.id, {
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'v-carve',
        depthMm: 0.1,
        depthPerPassMm: 0.6,
        vCarveFlatDepthEnabled: false,
      },
    });
    useStore.setState({
      selectedObjectId: 'Fixed',
      additionalSelectedIds: new Set(['Flowing']),
    });

    const { host, root } = await render();
    try {
      expect(
        host.querySelector('input[aria-label="Cut depth for selected operations"]'),
      ).toBeNull();
      expect(host.textContent).toContain('Normal V-carve calculates depth from geometry');
      expect(host.textContent).toContain('V-carve flat floor uses its own Floor depth');
      expect(host.textContent).toContain('Depth per pass stays unchanged');
      expect(useStore.getState().project.scene.layers[1]?.cnc?.depthPerPassMm).toBe(0.6);
    } finally {
      await cleanup(root, host);
    }
  });
});
