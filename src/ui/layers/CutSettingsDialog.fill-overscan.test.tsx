import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { createLayer, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CutSettingsDialog } from './CutSettingsDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
});

describe('CutSettingsDialog fill overscan', () => {
  // ADR-234 bounds the 4040-safe Scan Line entry runway to 5 mm, while the
  // field accepts 25 mm for the policies that use the full value. A larger
  // stored value must read as capped on that machine, not silently ignored.
  it('shows the 4040-safe Scan Line bound instead of silently capping a larger overscan', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <CutSettingsDialog
            layer={fillLayer({ fillOverscanMm: 10 })}
            onCancel={() => undefined}
            onApply={() => undefined}
          />,
        );
      });
      expect(host.textContent).not.toContain('stored 10;');

      await act(async () => {
        useStore.getState().replaceDeviceProfile(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
      });
      expect(host.textContent).toContain('stored 10; 4040-safe Scan Line uses up to 5 mm');

      const overscan = host.querySelector('input[name="fillOverscanMm"]');
      if (!(overscan instanceof HTMLInputElement)) throw new Error('fill overscan input missing');
      await act(async () => {
        overscan.value = '4';
        Simulate.change(overscan);
      });
      expect(host.textContent).not.toContain('4040-safe Scan Line uses up to');
      await act(async () => {
        overscan.value = '0';
        Simulate.change(overscan);
      });
      expect(host.textContent).not.toContain('generic effective target');

      const style = host.querySelector('select[name="fillStyle"]');
      if (!(style instanceof HTMLSelectElement)) throw new Error('fill style select missing');
      await act(async () => {
        overscan.value = '10';
        Simulate.change(overscan);
        style.value = 'island';
        Simulate.change(style);
      });
      expect(host.textContent).not.toContain('4040-safe Scan Line uses up to');
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});

function fillLayer(patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: '#ff0000', color: '#ff0000', mode: 'fill' }), ...patch };
}
