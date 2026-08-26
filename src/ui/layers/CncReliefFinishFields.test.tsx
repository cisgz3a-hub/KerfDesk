import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import { resetStore } from '../state/test-helpers';
import { ReliefLayerRows } from './CncLayerToolFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LAYER = createLayer({ id: 'relief-layer', color: '#ff0000' });

afterEach(resetStore);

describe('ReliefLayerRows', () => {
  it('keeps scallop editable without exposing the Startup-owned finishing bit', async () => {
    const onCommit = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <ReliefLayerRows
          layer={LAYER}
          settings={{
            ...DEFAULT_CNC_LAYER_SETTINGS,
            reliefFinishToolId: 'missing-finisher',
          }}
          onCommit={onCommit}
        />,
      );
    });
    try {
      expect(
        host.querySelector('select[aria-label="Relief finishing bit for #ff0000"]'),
      ).toBeNull();
      const scallop = host.querySelector('input[aria-label="Relief scallop height for #ff0000"]');
      if (!(scallop instanceof HTMLInputElement)) throw new Error('scallop input missing');
      expect(scallop.title).toContain('finishing bit assigned in Startup Setup');

      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(scallop, '0.05');
        scallop.dispatchEvent(new Event('input', { bubbles: true }));
        scallop.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      });
      expect(onCommit).toHaveBeenCalledWith({ reliefScallopMm: 0.05 });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
