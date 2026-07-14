import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createLayer, type Layer } from '../../core/scene';
import { CutSettingsDialog } from './CutSettingsDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('CutSettingsDialog fill density controls', () => {
  it('offers Auto, Constant, and Dynamic power modes only for vector layers', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <CutSettingsDialog
            layer={lineLayer()}
            onCancel={() => undefined}
            onApply={() => undefined}
          />,
        );
      });
      const powerMode = host.querySelector('select[aria-label="Cut settings power mode"]');
      if (!(powerMode instanceof HTMLSelectElement)) throw new Error('power mode select missing');
      expect(powerMode.value).toBe('auto');
      expect([...powerMode.options].map((option) => option.value)).toEqual([
        'auto',
        'constant',
        'dynamic',
      ]);

      const mode = host.querySelector('select[aria-label="Cut settings mode"]');
      if (!(mode instanceof HTMLSelectElement)) throw new Error('mode select missing');
      await act(async () => {
        mode.value = 'image';
        Simulate.change(mode);
      });
      expect(host.querySelector('select[aria-label="Cut settings power mode"]')).toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('shows only the backed field group for the selected mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <CutSettingsDialog
            layer={lineLayer()}
            onCancel={() => undefined}
            onApply={() => undefined}
          />,
        );
      });

      const mode = host.querySelector('select[aria-label="Cut settings mode"]');
      if (!(mode instanceof HTMLSelectElement)) throw new Error('mode select missing');
      expect(host.textContent).toContain('Kerf Offset');
      expect(host.textContent).toContain('Tabs / Bridges');
      expect(host.textContent).not.toContain('Line Interval');
      expect(host.textContent).not.toContain('Dither');

      await act(async () => {
        mode.value = 'fill';
        Simulate.change(mode);
      });
      expect(host.textContent).toContain('Line Interval');
      expect(host.textContent).not.toContain('Kerf Offset');
      expect(host.textContent).not.toContain('Tabs / Bridges');
      expect(host.textContent).not.toContain('Dither');

      await act(async () => {
        mode.value = 'image';
        Simulate.change(mode);
      });
      expect(host.textContent).not.toContain('Lines / Inch');
      expect(host.textContent).not.toContain('Kerf Offset');
      expect(host.textContent).not.toContain('Tabs / Bridges');
      expect(host.textContent).toContain('Dither');
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

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
      expect(lpi.validity.stepMismatch).toBe(false);
      expect(lpi.checkValidity()).toBe(true);
      await submitDialog(host);

      expect(requireApplied(applied).hatchSpacingMm).toBeCloseTo(0.1, 8);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('preserves fill density when interval or lines-per-inch edits are blank', async () => {
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
        interval.value = '';
        Simulate.change(interval);
      });
      await submitDialog(host);

      expect(requireApplied(applied).hatchSpacingMm).toBe(0.2);

      const lpi = host.querySelector('input[aria-label="Cut settings lines per inch"]');
      if (!(lpi instanceof HTMLInputElement)) throw new Error('lines per inch input missing');
      await act(async () => {
        lpi.value = '';
        Simulate.change(lpi);
      });
      await submitDialog(host);

      expect(requireApplied(applied).hatchSpacingMm).toBe(0.2);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('saves the fill cross-hatch checkbox', async () => {
    let applied: Partial<Layer> | null = null;
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
            onApply={(patch) => {
              applied = patch;
            }}
          />,
        );
      });

      const crossHatch = host.querySelector('input[aria-label="Cut settings cross-hatch"]');
      if (!(crossHatch instanceof HTMLInputElement)) throw new Error('cross-hatch input missing');
      await act(async () => {
        crossHatch.checked = true;
        Simulate.change(crossHatch);
      });
      await submitDialog(host);

      expect(
        (requireApplied(applied) as { readonly fillCrossHatch?: boolean }).fillCrossHatch,
      ).toBe(true);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('renders a fill direction preview with a perpendicular cross-hatch pass', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <CutSettingsDialog
            layer={fillLayer({ fillCrossHatch: true, hatchAngleDeg: 45 })}
            onCancel={() => undefined}
            onApply={() => undefined}
          />,
        );
      });

      const preview = host.querySelector('svg[aria-label="Fill scan direction preview"]');
      if (!(preview instanceof SVGSVGElement)) throw new Error('direction preview missing');
      expect(preview.querySelectorAll('[data-fill-pass]')).toHaveLength(2);
      expect(preview.querySelector('[data-fill-pass="primary"]')).not.toBeNull();
      expect(preview.querySelector('[data-fill-pass="cross-hatch"]')).not.toBeNull();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('exposes default layer settings actions without applying staged edits', async () => {
    const onApply = vi.fn();
    const onMakeDefault = vi.fn();
    const onMakeDefaultForAll = vi.fn();
    const onResetToDefault = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <CutSettingsDialog
            layer={fillLayer({ power: 44 })}
            onCancel={() => undefined}
            onApply={onApply}
            onMakeDefault={onMakeDefault}
            onMakeDefaultForAll={onMakeDefaultForAll}
            onResetToDefault={onResetToDefault}
          />,
        );
      });

      const makeDefault = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Make Default',
      );
      if (!(makeDefault instanceof HTMLButtonElement)) {
        throw new Error('Make Default button missing');
      }

      await act(async () => {
        makeDefault.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onMakeDefault).toHaveBeenCalledTimes(1);
      expect(onMakeDefaultForAll).not.toHaveBeenCalled();
      expect(onResetToDefault).not.toHaveBeenCalled();
      expect(onApply).not.toHaveBeenCalled();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});

function fillLayer(patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: '#ff0000', color: '#ff0000', mode: 'fill' }), ...patch };
}

function lineLayer(patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: '#ff0000', color: '#ff0000', mode: 'line' }), ...patch };
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
