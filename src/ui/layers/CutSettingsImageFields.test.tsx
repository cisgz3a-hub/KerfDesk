// A LightBurn recipe at a 0.5 mm or 0.025 mm interval imports as 2 or 40
// lines/mm, outside the 5-25 range offered for new entries. Compile burns the
// stored value, so Cut Settings must show that one density in both fields and
// keep it when the user applies an unrelated change.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createLayer, type Layer } from '../../core/scene';
import { CutSettingsDialog } from './CutSettingsDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Cut Settings image density outside the recommended range', () => {
  it.each([
    { linesPerMm: 2, intervalMm: '0.5', dpi: '50.8' },
    { linesPerMm: 40, intervalMm: '0.025', dpi: '1016' },
  ])(
    'shows and keeps a stored $linesPerMm lines/mm while the speed changes',
    async ({ linesPerMm, intervalMm, dpi }) => {
      const view = await renderDialog({ mode: 'image', linesPerMm });
      try {
        expect(input(view.host, 'line interval').value).toBe(intervalMm);
        expect(input(view.host, 'DPI').value).toBe(dpi);

        await change(input(view.host, 'speed'), '2000');
        await submit(view.form);

        expect(view.onApply).toHaveBeenCalledOnce();
        expect(view.onApply.mock.calls[0]?.[0]).toMatchObject({ linesPerMm, speed: 2000 });
      } finally {
        await view.close();
      }
    },
  );

  it('still holds a new density entry to the recommended range', async () => {
    const view = await renderDialog({ mode: 'image', linesPerMm: 2 });
    try {
      await change(input(view.host, 'DPI'), '60');
      expect(input(view.host, 'DPI').value).toBe('127');
      expect(input(view.host, 'line interval').value).toBe('0.2');

      await submit(view.form);

      expect(view.onApply.mock.calls[0]?.[0]).toMatchObject({ linesPerMm: 5 });
    } finally {
      await view.close();
    }
  });
});

async function renderDialog(patch: Partial<Layer>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onApply = vi.fn();
  const layer = { ...createLayer({ id: 'img', color: '#000000' }), ...patch };
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

// Clicking the submit button runs the browser's own range check, which is what
// used to block Apply while the stored interval sat above the field's maximum.
async function submit(form: HTMLFormElement): Promise<void> {
  expect(form.checkValidity()).toBe(true);
  await act(async () => form.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
}
