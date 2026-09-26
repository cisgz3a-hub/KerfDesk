import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS, type CncLayerSettings } from '../../core/scene';
import { resetStore } from '../state/test-helpers';
import { ReliefLayerRows } from './CncLayerToolFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LAYER = createLayer({ id: 'relief-layer', color: '#ff0000' });

afterEach(resetStore);

describe('ReliefLayerRows', () => {
  it('keeps scallop separate from the finishing-bit chooser in Tool & material', async () => {
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
      expect(scallop.title).toContain('finishing bit chosen in Tool & material');

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

  it('shows the roughing allowance, finish strategy and raster direction (ADR-423)', async () => {
    const onCommit = vi.fn();
    const { host, root } = await renderRows(
      { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave' },
      onCommit,
    );
    try {
      const allowance = host.querySelector('input[aria-label="Rough allowance for #ff0000"]');
      if (!(allowance instanceof HTMLInputElement)) throw new Error('allowance input missing');
      // Unset, relief roughing leaves 0.5 mm.
      expect(allowance.value).toBe('0.5');
      const strategy = select(host, 'Relief finish strategy for #ff0000');
      expect(strategy.value).toBe('raster');
      const axis = select(host, 'Relief raster direction for #ff0000');
      expect(axis.value).toBe('x');

      await act(async () => {
        strategy.value = 'raster-waterline';
        strategy.dispatchEvent(new Event('change', { bubbles: true }));
        axis.value = 'y';
        axis.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(onCommit).toHaveBeenCalledWith({ reliefFinishStrategy: 'raster-waterline' });
      expect(onCommit).toHaveBeenCalledWith({ reliefRasterAxis: 'y' });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('offers a cut direction only where the cut type has none of its own', async () => {
    const onCommit = vi.fn();
    const engrave = await renderRows(
      { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave', cutDirection: 'climb' },
      onCommit,
    );
    try {
      const direction = select(engrave.host, 'Relief cut direction for #ff0000');
      await act(async () => {
        direction.value = 'conventional';
        direction.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(onCommit).toHaveBeenCalledWith({ cutDirection: 'conventional' });
    } finally {
      await act(async () => engrave.root.unmount());
      engrave.host.remove();
    }
    const pocket = await renderRows({ ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket' }, onCommit);
    try {
      expect(
        pocket.host.querySelector('select[aria-label="Relief cut direction for #ff0000"]'),
      ).toBeNull();
    } finally {
      await act(async () => pocket.root.unmount());
      pocket.host.remove();
    }
  });
});

async function renderRows(settings: CncLayerSettings, onCommit: (patch: object) => void) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ReliefLayerRows layer={LAYER} settings={settings} onCommit={onCommit} />);
  });
  return { host, root };
}

function select(host: HTMLElement, label: string): HTMLSelectElement {
  const element = host.querySelector(`select[aria-label="${label}"]`);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`${label} missing`);
  return element;
}
