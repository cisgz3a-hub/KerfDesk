import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { SelectedObjectProperties } from './SelectedObjectProperties';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(resetStore);

describe('SelectedObjectProperties mixed power scale', () => {
  it('shows Mixed instead of 100 and applies an explicit edit to the selection', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#00ff00']));
    useStore.getState().selectObject('O1');
    useStore.getState().toggleSelectObject('O2');
    useStore.getState().setObjectsPowerScale(['O1'], 50);
    useStore.getState().setObjectsPowerScale(['O2'], 80);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<SelectedObjectProperties />));
    try {
      const input = host.querySelector('input[aria-label="Power scale for selected objects"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('power scale input missing');
      expect(input.value).toBe('');
      expect(input.placeholder).toBe('Mixed');
      expect(input.dataset.mixed).toBe('true');
      expect(input.getAttribute('aria-valuetext')).toBe('Mixed');

      await act(async () => Simulate.blur(input));
      expect(useStore.getState().project.scene.objects.map((object) => object.powerScale)).toEqual([
        50, 80,
      ]);

      await act(async () => {
        input.value = '60';
        Simulate.change(input);
      });
      await act(async () => Simulate.blur(input));

      expect(useStore.getState().project.scene.objects.map((object) => object.powerScale)).toEqual([
        60, 60,
      ]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('edits and discloses the effective object override instead of the base operation', async () => {
    useStore.getState().importSvgObject(svgObj('Override', ['#000000']));
    const before = useStore.getState();
    useStore.setState({
      project: {
        ...before.project,
        scene: {
          ...before.project.scene,
          objects: before.project.scene.objects.map((object) =>
            object.id === 'Override'
              ? {
                  ...object,
                  operationOverride: {
                    mode: 'fill' as const,
                    fillStyle: 'offset' as const,
                    hatchSpacingMm: 0.35,
                    fillBidirectional: false,
                  },
                }
              : object,
          ),
        },
      },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<SelectedObjectProperties />));
    try {
      expect(host.textContent).toContain('Effective artwork override');
      const spacing = host.querySelector('input[aria-label="Hatch spacing for selected objects"]');
      const bidirectional = host.querySelector(
        'input[aria-label="Bidirectional fill for selected objects"]',
      );
      if (!(spacing instanceof HTMLInputElement)) throw new Error('effective spacing missing');
      if (!(bidirectional instanceof HTMLInputElement))
        throw new Error('effective direction missing');
      expect(spacing.value).toBe('0.35');
      expect(bidirectional.checked).toBe(false);

      await act(async () => {
        spacing.value = '0.5';
        Simulate.change(spacing);
      });
      await act(async () => Simulate.blur(spacing));

      const state = useStore.getState();
      expect(state.project.scene.objects[0]?.operationOverride?.hatchSpacingMm).toBe(0.5);
      expect(state.project.scene.layers[0]).toMatchObject({ mode: 'line', hatchSpacingMm: 0.1 });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
