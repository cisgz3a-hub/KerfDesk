import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { PULSE_HOVER_DWELL_MS } from '../workspace/artwork-pulse';
import { LayerRow } from './LayerRow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useUiStore.getState().setHoveredOperationId(null);
  document.body.replaceChildren();
});

// React derives pointerenter/leave from pointerover/out with a related target.
function pointer(type: 'pointerover' | 'pointerout', target: Element, related: Element): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: related }));
}

describe('LayerRow canvas pulse (ADR-620)', () => {
  it('names its operation for the canvas pulse while the pointer is over the row', async () => {
    useStore.getState().importSvgObject(svgObj('Pulse operation', ['#ff0000']));
    const layer = useStore.getState().project.scene.layers[0];
    if (layer === undefined) throw new Error('operation fixture missing');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(<LayerRow layer={layer} canMoveUp={false} canMoveDown={false} />),
    );
    const row = host.querySelector('[aria-label="Operation Pulse operation"]');
    if (row === null) throw new Error('operation row missing');

    const settle = (): Promise<void> =>
      act(async () => new Promise((resolve) => setTimeout(resolve, PULSE_HOVER_DWELL_MS + 30)));

    await act(async () => pointer('pointerover', row, document.body));
    await settle();
    expect(useUiStore.getState().hoveredOperationId).toBe(layer.id);
    await act(async () => pointer('pointerout', row, document.body));
    expect(useUiStore.getState().hoveredOperationId).toBeNull();

    // Passing over the row without settling pulses nothing.
    await act(async () => pointer('pointerover', row, document.body));
    await act(async () => pointer('pointerout', row, document.body));
    await settle();
    expect(useUiStore.getState().hoveredOperationId).toBeNull();

    // A row removed under the pointer must not leave its artwork pulsing.
    await act(async () => pointer('pointerover', row, document.body));
    await settle();
    await act(async () => root.unmount());
    expect(useUiStore.getState().hoveredOperationId).toBeNull();
  });

  it('pulses for keyboard focus within the row, as for the pointer', async () => {
    useStore.getState().importSvgObject(svgObj('Focus operation', ['#ff0000']));
    const layer = useStore.getState().project.scene.layers[0];
    if (layer === undefined) throw new Error('operation fixture missing');
    const outside = document.createElement('button');
    const host = document.createElement('div');
    document.body.append(outside, host);
    const root = createRoot(host);
    await act(async () =>
      root.render(<LayerRow layer={layer} canMoveUp={false} canMoveDown={false} />),
    );
    const buttons = host.querySelectorAll<HTMLElement>(
      '[aria-label="Operation Focus operation"] button',
    );
    const [first, second] = [buttons[0], buttons[1]];
    if (first === undefined || second === undefined) throw new Error('row buttons missing');
    const settle = (): Promise<void> =>
      act(async () => new Promise((resolve) => setTimeout(resolve, PULSE_HOVER_DWELL_MS + 30)));

    await act(async () => first.focus());
    await settle();
    expect(useUiStore.getState().hoveredOperationId).toBe(layer.id);
    // Moving between the row's own controls keeps the pulse's edge.
    await act(async () => second.focus());
    await settle();
    expect(useUiStore.getState().hoveredOperationId).toBe(layer.id);
    await act(async () => outside.focus());
    expect(useUiStore.getState().hoveredOperationId).toBeNull();

    // Tabbing past the row without settling pulses nothing.
    await act(async () => first.focus());
    await act(async () => outside.focus());
    await settle();
    expect(useUiStore.getState().hoveredOperationId).toBeNull();
    await act(async () => root.unmount());
  });
});
