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
  it('keeps scallop separate from the finishing-bit chooser under Bit', async () => {
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
          onCommitSettings={vi.fn()}
        />,
      );
    });
    try {
      expect(
        host.querySelector('select[aria-label="Relief finishing bit for #ff0000"]'),
      ).toBeNull();
      const scallop = host.querySelector('input[aria-label="Relief scallop height for #ff0000"]');
      if (!(scallop instanceof HTMLInputElement)) throw new Error('scallop input missing');
      expect(scallop.title).toContain('Relief finishing bit chosen under Bit above');

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

  it('offers a roughing ramp only where the cut type has no ramp row (ADR-424)', async () => {
    const onCommitSettings = vi.fn();
    const drill = await renderRows(
      { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'drill', rampEntryDeg: 3 },
      vi.fn(),
      onCommitSettings,
    );
    try {
      const ramp = drill.host.querySelector('input[aria-label="Roughing ramp for #ff0000"]');
      if (!(ramp instanceof HTMLInputElement)) throw new Error('ramp input missing');
      expect(ramp.value).toBe('3');
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(ramp, '0');
        ramp.dispatchEvent(new Event('input', { bubbles: true }));
        ramp.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      });
      // 0 plunges, so the angle is removed rather than stored as 0.
      const committed = onCommitSettings.mock.calls.at(-1)?.[0] as CncLayerSettings | undefined;
      expect(committed?.cutType).toBe('drill');
      expect(committed !== undefined && 'rampEntryDeg' in committed).toBe(false);
    } finally {
      await act(async () => drill.root.unmount());
      drill.host.remove();
    }
    const engrave = await renderRows(
      { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave' },
      vi.fn(),
    );
    try {
      expect(
        engrave.host.querySelector('input[aria-label="Roughing ramp for #ff0000"]'),
      ).toBeNull();
    } finally {
      await act(async () => engrave.root.unmount());
      engrave.host.remove();
    }
  });

  it('stores a slope step and removes it at 0 (ADR-422 Amendment 1)', async () => {
    const onCommitSettings = vi.fn();
    const rows = await renderRows(
      { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket', reliefFineStepMm: 0.3 },
      vi.fn(),
      onCommitSettings,
    );
    try {
      const field = rows.host.querySelector('input[aria-label="Slope step for #ff0000"]');
      if (!(field instanceof HTMLInputElement)) throw new Error('slope step input missing');
      expect(field.value).toBe('0.3');
      const enter = async (value: string) =>
        act(async () => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          setter?.call(field, value);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        });
      await enter('0.25');
      expect(onCommitSettings.mock.calls.at(-1)?.[0]).toMatchObject({ reliefFineStepMm: 0.25 });
      await enter('0');
      const committed = onCommitSettings.mock.calls.at(-1)?.[0] as CncLayerSettings | undefined;
      expect(committed?.cutType).toBe('pocket');
      expect(committed !== undefined && 'reliefFineStepMm' in committed).toBe(false);
    } finally {
      await act(async () => rows.root.unmount());
      rows.host.remove();
    }
  });

  it('chooses which bit finishes the flats (ADR-450)', async () => {
    const onCommit = vi.fn();
    const { host, root } = await renderRows(
      { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave' },
      onCommit,
    );
    try {
      const flats = select(host, 'Relief flats finished by for #ff0000');
      // Unset, the finishing bit covers the flats as before.
      expect(flats.value).toBe('finishing-bit');
      await act(async () => {
        flats.value = 'roughing-bit';
        flats.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(onCommit).toHaveBeenCalledWith({ reliefFlatFinish: 'roughing-bit' });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

async function renderRows(
  settings: CncLayerSettings,
  onCommit: (patch: object) => void,
  onCommitSettings: (settings: CncLayerSettings) => void = vi.fn(),
) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ReliefLayerRows
        layer={LAYER}
        settings={settings}
        onCommit={onCommit}
        onCommitSettings={onCommitSettings}
      />,
    );
  });
  return { host, root };
}

function select(host: HTMLElement, label: string): HTMLSelectElement {
  const element = host.querySelector(`select[aria-label="${label}"]`);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`${label} missing`);
  return element;
}
