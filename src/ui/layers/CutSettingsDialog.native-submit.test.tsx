import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createLayer, type Layer } from '../../core/scene';
import { dpiToLinesPerMm, lineIntervalMmToLinesPerMm } from '../../core/raster';
import { CutSettingsDialog } from './CutSettingsDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderDialog(patch: Partial<Layer>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onApply = vi.fn();
  const layer = { ...createLayer({ id: 'test', color: '#000000' }), ...patch };
  await act(async () =>
    root.render(<CutSettingsDialog layer={layer} onApply={onApply} onCancel={vi.fn()} />),
  );
  const form = host.querySelector('form');
  if (!form) throw new Error('form missing');
  return {
    host,
    form,
    onApply,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const field = host.querySelector(`input[aria-label="Cut settings ${label}"]`);
  if (!(field instanceof HTMLInputElement)) throw new Error(`missing ${label}`);
  return field;
}

async function change(field: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

async function submit(form: HTMLFormElement, method: 'click' | 'requestSubmit'): Promise<void> {
  expect(form.checkValidity()).toBe(true);
  await act(async () => {
    if (method === 'requestSubmit') form.requestSubmit();
    else form.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  });
}

describe('native cut-settings submission', () => {
  it.each(['fill', 'image'] as const)(
    'preserves exact %s density through native click and implicit-submit validation',
    async (mode) => {
      for (const density of [300, 287.35]) {
        for (const method of ['click', 'requestSubmit'] as const) {
          const view = await renderDialog({ mode });
          try {
            await change(
              input(view.host, mode === 'fill' ? 'lines per inch' : 'DPI'),
              String(density),
            );
            expect(input(view.host, 'line interval').validity.stepMismatch).toBe(false);
            await submit(view.form, method);
            expect(view.onApply).toHaveBeenCalledOnce();
            const saved = view.onApply.mock.calls[0]?.[0] as Partial<Layer>;
            expect(mode === 'fill' ? saved.hatchSpacingMm : saved.linesPerMm).toBeCloseTo(
              mode === 'fill' ? 25.4 / density : dpiToLinesPerMm(density),
              12,
            );
          } finally {
            await view.close();
          }
        }
      }
    },
  );

  it.each(['fill', 'image'] as const)(
    'preserves an entered %s interval rather than its rounded reciprocal',
    async (mode) => {
      const view = await renderDialog({ mode });
      try {
        await change(input(view.host, 'line interval'), '0.08337');
        await submit(view.form, 'click');
        const saved = view.onApply.mock.calls[0]?.[0] as Partial<Layer>;
        expect(mode === 'fill' ? saved.hatchSpacingMm : saved.linesPerMm).toBeCloseTo(
          mode === 'fill' ? 0.08337 : lineIntervalMmToLinesPerMm(0.08337),
          12,
        );
      } finally {
        await view.close();
      }
    },
  );

  it('uses the raised draft maximum for grayscale minimum power', async () => {
    const view = await renderDialog({
      mode: 'image',
      ditherAlgorithm: 'grayscale',
      power: 20,
      minPower: 10,
    });
    try {
      await change(input(view.host, 'power'), '80');
      await change(input(view.host, 'minPower'), '50');
      expect(input(view.host, 'minPower').max).toBe('80');
      await submit(view.form, 'click');
      expect(view.onApply).toHaveBeenCalledWith(
        expect.objectContaining({ power: 80, minPower: 50 }),
      );
    } finally {
      await view.close();
    }
  });

  it('reconciles the minimum when the draft maximum is reduced', async () => {
    const view = await renderDialog({
      mode: 'image',
      ditherAlgorithm: 'grayscale',
      power: 80,
      minPower: 50,
    });
    try {
      await change(input(view.host, 'power'), '30');
      expect(input(view.host, 'minPower').value).toBe('30');
      await submit(view.form, 'requestSubmit');
      expect(view.onApply).toHaveBeenCalledWith(
        expect.objectContaining({ power: 30, minPower: 30 }),
      );
    } finally {
      await view.close();
    }
  });
});
