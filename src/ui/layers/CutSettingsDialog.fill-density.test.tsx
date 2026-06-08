import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it } from 'vitest';
import { createLayer, type Layer } from '../../core/scene';
import { CutSettingsDialog } from './CutSettingsDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('CutSettingsDialog fill density controls', () => {
  it('shows LightBurn-style line interval and lines per inch controls for fill layers', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <CutSettingsDialog
            layer={fillLayer()}
            onCancel={() => undefined}
            onApply={() => undefined}
          />,
        );
      });

      expect(host.textContent).toContain('Line Interval');
      expect(host.textContent).toContain('Lines / Inch');
      expect(host.querySelector('input[aria-label="Cut settings line interval"]')).not.toBeNull();
      expect(host.querySelector('input[aria-label="Cut settings lines per inch"]')).not.toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('saves fill line interval edits to hatchSpacingMm', async () => {
    let applied: Partial<Layer> | null = null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <CutSettingsDialog
            layer={fillLayer({ hatchSpacingMm: 0.2 })}
            onCancel={() => undefined}
            onApply={(patch) => {
              applied = patch;
            }}
          />,
        );
      });

      const interval = host.querySelector('input[aria-label="Cut settings line interval"]');
      if (!(interval instanceof HTMLInputElement)) throw new Error('line interval input missing');
      await act(async () => {
        interval.value = '0.25';
        Simulate.change(interval);
      });
      await submitDialog(host);

      expect(requireApplied(applied).hatchSpacingMm).toBe(0.25);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('saves fill lines per inch edits as the reciprocal hatchSpacingMm', async () => {
    let applied: Partial<Layer> | null = null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <CutSettingsDialog
            layer={fillLayer({ hatchSpacingMm: 0.2 })}
            onCancel={() => undefined}
            onApply={(patch) => {
              applied = patch;
            }}
          />,
        );
      });

      const lpi = host.querySelector('input[aria-label="Cut settings lines per inch"]');
      if (!(lpi instanceof HTMLInputElement)) throw new Error('lines per inch input missing');
      await act(async () => {
        lpi.value = '254';
        Simulate.change(lpi);
      });
      await submitDialog(host);

      expect(requireApplied(applied).hatchSpacingMm).toBeCloseTo(0.1, 8);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});

function fillLayer(patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: '#ff0000', color: '#ff0000', mode: 'fill' }), ...patch };
}

function requireApplied(patch: Partial<Layer> | null): Partial<Layer> {
  if (patch === null) throw new Error('onApply was not called');
  return patch;
}

async function submitDialog(host: HTMLElement): Promise<void> {
  const form = host.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('form missing');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
