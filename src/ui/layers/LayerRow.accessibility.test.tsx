import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { LayerRow } from './LayerRow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useUiStore.getState().setActiveLayerColor(null);
  document.body.replaceChildren();
});

describe('LayerRow activation accessibility', () => {
  it('uses a native keyboard-operable button and exposes a visible active cue', async () => {
    const mounted = await mountRow();
    try {
      expect(mounted.activation.type).toBe('button');
      await act(async () => mounted.activation.click());
      expect(useUiStore.getState().activeLayerColor).toBe(mounted.layerColor);
      expect(mounted.activation.getAttribute('aria-pressed')).toBe('true');
      expect(mounted.row.textContent).toContain('Active');
    } finally {
      await mounted.unmount();
    }
  });

  it('does not activate when a nested operation control is clicked', async () => {
    const mounted = await mountRow();
    try {
      const show = mounted.row.querySelector<HTMLInputElement>('input[aria-label^="Show "]');
      if (show === null) throw new Error('Show control missing');
      await act(async () => show.click());
      expect(useUiStore.getState().activeLayerColor).toBeNull();
    } finally {
      await mounted.unmount();
    }
  });
});

async function mountRow(): Promise<{
  readonly row: HTMLElement;
  readonly activation: HTMLButtonElement;
  readonly layerColor: string;
  readonly unmount: () => Promise<void>;
}> {
  useStore.getState().importSvgObject(svgObj('Keyboard operation', ['#ff0000']));
  useUiStore.getState().setActiveLayerColor(null);
  const layer = useStore.getState().project.scene.layers[0];
  if (layer === undefined) throw new Error('operation fixture missing');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<LayerRow layer={layer} canMoveUp={false} canMoveDown={false} />),
  );
  const row = host.querySelector<HTMLElement>('[aria-label="Operation Keyboard operation"]');
  if (row === null) throw new Error('operation row missing');
  const activation = row.querySelector<HTMLButtonElement>(
    'button[aria-label="Activate operation Keyboard operation"]',
  );
  if (activation === null) throw new Error('operation activation missing');
  return {
    row,
    activation,
    layerColor: layer.color,
    unmount: async () => act(async () => root.unmount()),
  };
}
