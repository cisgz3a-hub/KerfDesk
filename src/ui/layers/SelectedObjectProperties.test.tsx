import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createRectangle } from '../../core/shapes';
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

  it('shows the selected artwork CNC operation in CNC mode', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    useStore.getState().setMachineKind('cnc');
    const { host, root } = await render();
    try {
      expect(host.querySelector('[aria-label="Selected object properties"]')).not.toBeNull();
      expect(host.querySelector('select[aria-label^="Cut type for"]')).not.toBeNull();
      expect(host.querySelector('input[aria-label="Power scale for selected objects"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('rematerializes a rectangle when its corner radius is edited', async () => {
    useStore.getState().drawShape(
      createRectangle({
        id: 'rect-1',
        color: '#ff0000',
        spec: { widthMm: 40, heightMm: 20, cornerRadiusMm: 0 },
      }),
    );
    const before = useStore.getState().project.scene.objects[0];
    const { host, root } = await render();
    try {
      const input = host.querySelector('input[aria-label="Rectangle corner radius"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('corner radius input missing');
      await act(async () => {
        input.value = '5';
        Simulate.change(input);
      });
      await act(async () => {
        Simulate.blur(input);
      });

      const after = useStore.getState().project.scene.objects[0];
      expect(after).toMatchObject({
        id: 'rect-1',
        spec: { kind: 'rect', widthMm: 40, heightMm: 20, cornerRadiusMm: 5 },
      });
      expect(after).not.toEqual(before);
      expect(
        after !== undefined && 'paths' in after
          ? after.paths[0]?.curves?.[0]?.segments.some((segment) => segment.kind === 'cubic')
          : false,
      ).toBe(true);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps parametric geometry controls available in CNC mode', async () => {
    useStore.getState().drawShape(
      createRectangle({
        id: 'rect-1',
        color: '#ff0000',
        spec: { widthMm: 40, heightMm: 20, cornerRadiusMm: 0 },
      }),
    );
    useStore.getState().setMachineKind('cnc');
    const { host, root } = await render();
    try {
      expect(host.querySelector('input[aria-label="Rectangle width"]')).not.toBeNull();
      expect(host.querySelector('input[aria-label="Power scale for selected objects"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('edits the selected artwork operation without changing same-colored artwork', async () => {
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
      expect(state.project.scene.layers.find((layer) => layer.name === 'O1')?.mode).toBe('line');
      expect(state.project.scene.layers.find((layer) => layer.name === 'O2')?.mode).toBe('fill');
      expect(
        state.project.scene.objects.every((object) => object.operationOverride === undefined),
      ).toBe(true);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('offers one unified operation when selected artworks have different settings', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#000000']));
    useStore.setState({ selectedObjectId: 'O1', additionalSelectedIds: new Set(['O2']) });

    const { host, root } = await render();
    try {
      expect(host.querySelector('[aria-label="Multiple artwork operations"]')).not.toBeNull();
      const unify = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Use one operation for selection',
      );
      if (!(unify instanceof HTMLButtonElement)) throw new Error('unify button missing');
      await act(async () => unify.click());
      const state = useStore.getState();
      expect(state.project.scene.objects.map((object) => object.operationIds)).toEqual([
        [state.project.scene.layers[0]?.id],
        [state.project.scene.layers[0]?.id],
      ]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
