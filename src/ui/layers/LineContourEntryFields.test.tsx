import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createLayer, type Layer } from '../../core/scene';
import { CutSettingsDialog } from './CutSettingsDialog';
import { LayerRowSettingsFields } from './LayerRowFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('shared Line contour-entry setting', () => {
  it('exposes and commits the shared value in the inline Line editor', async () => {
    const commit = vi.fn();
    const layer = lineLayer({ fillOverscanMm: 5 });
    const mounted = await mount(
      <LayerRowSettingsFields
        layer={layer}
        operationTarget={{ settings: layer, selectedObjectCount: 0, commit }}
      />,
    );
    try {
      const input = requireInput(mounted.host, 'Contour entry for Operation');
      expect(input.value).toBe('5');
      expect(input.title).toContain('Shared with Fill overscan');
      await act(async () => {
        input.value = '2.5';
        Simulate.change(input);
      });
      await act(async () => {
        Simulate.blur(input);
      });
      expect(commit).toHaveBeenCalledWith({ fillOverscanMm: 2.5 });
    } finally {
      await mounted.unmount();
    }
  });

  it('round-trips a custom value through Advanced cut settings', async () => {
    const onApply = vi.fn();
    const mounted = await mount(
      <CutSettingsDialog layer={lineLayer()} onCancel={() => undefined} onApply={onApply} />,
    );
    try {
      const input = requireInput(mounted.host, 'Cut settings contour entry');
      expect(input.name).toBe('fillOverscanMm');
      expect(input.title).toContain('other profiles may not apply it');
      input.value = '2';
      const form = mounted.host.querySelector('form');
      if (!(form instanceof HTMLFormElement)) throw new Error('form missing');
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ fillOverscanMm: 2 }));
    } finally {
      await mounted.unmount();
    }
  });
});

function lineLayer(patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: 'line', color: '#000000', mode: 'line' }), ...patch };
}

function requireInput(host: HTMLElement, ariaLabel: string): HTMLInputElement {
  const input = host.querySelector(`input[aria-label="${ariaLabel}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${ariaLabel} input missing`);
  return input;
}

async function mount(node: React.ReactNode): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(node);
  });
  return {
    host,
    unmount: async () => {
      await act(async () => root?.unmount());
      host.remove();
    },
  };
}
