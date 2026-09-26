import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createLayer, type Layer } from '../../core/scene';
import { CutSettingsDialog } from './CutSettingsDialog';
import { readCutSettingsPatch } from './cut-settings-draft';

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

function field(host: HTMLElement, label: string): HTMLInputElement {
  const element = host.querySelector(`input[aria-label="Cut settings ${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`missing ${label}`);
  return element;
}

async function change(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function submit(form: HTMLFormElement): Promise<void> {
  expect(form.checkValidity()).toBe(true);
  await act(async () => {
    form.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  });
}

function formData(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('Cut Settings perforation, overcut and image overscan (ADR-415)', () => {
  it('applies perforation and overcut from the Line fields', async () => {
    const view = await renderDialog({ mode: 'line' });
    await act(async () => field(view.host, 'enable perforation').click());
    await change(field(view.host, 'perforation cut length'), '2.5');
    await change(field(view.host, 'perforation skip length'), '0.75');
    await change(field(view.host, 'overcut'), '1.2');
    await submit(view.form);
    expect(view.onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        perforationEnabled: true,
        perforationCutMm: 2.5,
        perforationSkipMm: 0.75,
        overcutMm: 1.2,
      }),
    );
    await view.close();
  });

  it('opens stored uneven values without blocking Apply', async () => {
    const view = await renderDialog({
      mode: 'line',
      perforationEnabled: true,
      perforationCutMm: 2.37,
      perforationSkipMm: 0.33,
      overcutMm: 0.25,
    });
    await submit(view.form);
    expect(view.onApply).toHaveBeenCalledWith(
      expect.objectContaining({ perforationCutMm: 2.37, perforationSkipMm: 0.33, overcutMm: 0.25 }),
    );
    await view.close();
  });

  it('shows the run-up the machine needs and applies the image overscan', async () => {
    const view = await renderDialog({ mode: 'image', speed: 6000, imageOverscanMm: 6.94 });
    expect(view.host.textContent).toContain('needs about');
    await change(field(view.host, 'image overscan'), '9');
    await submit(view.form);
    expect(view.onApply).toHaveBeenCalledWith(expect.objectContaining({ imageOverscanMm: 9 }));
    await view.close();
  });

  it('leaves the other process settings alone when the fields are not shown', () => {
    const layer = {
      ...createLayer({ id: 'f', color: '#ff0000', mode: 'fill' }),
      perforationEnabled: true,
      overcutMm: 2,
      imageOverscanMm: 7,
    };
    const patch = readCutSettingsPatch(
      formData({ mode: 'fill', power: '30', speed: '1500', passes: '1' }),
      layer,
    );
    expect(patch).not.toHaveProperty('perforationEnabled');
    expect(patch).not.toHaveProperty('overcutMm');
    expect(patch).not.toHaveProperty('imageOverscanMm');
  });

  it('clamps typed values into range', () => {
    const layer = createLayer({ id: 'l', color: '#ff0000' });
    const patch = readCutSettingsPatch(
      formData({
        mode: 'line',
        power: '30',
        speed: '1500',
        passes: '1',
        overcutMm: '-4',
        perforationCutMm: '0',
        perforationSkipMm: '900',
      }),
      layer,
    );
    expect(patch).toMatchObject({
      overcutMm: 0,
      perforationEnabled: false,
      perforationCutMm: 0.01,
      perforationSkipMm: 100,
    });
  });
});
