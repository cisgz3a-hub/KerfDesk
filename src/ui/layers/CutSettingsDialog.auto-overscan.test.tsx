import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createLayer, type Layer } from '../../core/scene';
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

function field(host: HTMLElement, label: string): HTMLInputElement | null {
  const element = host.querySelector(`input[aria-label="Cut settings ${label}"]`);
  return element instanceof HTMLInputElement ? element : null;
}

function requireField(host: HTMLElement, label: string): HTMLInputElement {
  const element = field(host, label);
  if (element === null) throw new Error(`missing ${label}`);
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

describe('Cut Settings automatic overscan (ADR-495)', () => {
  it('turns Automatic on for an image and keeps the stored overscan', async () => {
    const view = await renderDialog({ mode: 'image', speed: 3000, imageOverscanMm: 6 });
    const overscan = requireField(view.host, 'image overscan');
    expect(overscan.disabled).toBe(false);
    await act(async () => requireField(view.host, 'automatic overscan').click());
    expect(overscan.disabled).toBe(true);
    expect(view.host.textContent).toContain('Automatic runs 2.8 mm');
    await submit(view.form);
    const patch = view.onApply.mock.calls[0]?.[0] as Partial<Layer>;
    expect(patch.autoOverscan).toBe(true);
    expect(patch).not.toHaveProperty('imageOverscanMm');
    await view.close();
  });

  it('turns Automatic off again for a fill and applies the typed overscan', async () => {
    const view = await renderDialog({
      mode: 'fill',
      fillStyle: 'scanline',
      speed: 3000,
      hatchAngleDeg: 45,
      autoOverscan: true,
    });
    expect(view.host.textContent).toContain('Automatic runs 2 mm');
    await act(async () => requireField(view.host, 'automatic overscan').click());
    await change(requireField(view.host, 'fillOverscanMm'), '4');
    await submit(view.form);
    expect(view.onApply).toHaveBeenCalledWith(
      expect.objectContaining({ autoOverscan: false, fillOverscanMm: 4 }),
    );
    await view.close();
  });

  it('offers no switch on Follow Shape fills or Line cuts', async () => {
    const offset = await renderDialog({ mode: 'fill', fillStyle: 'offset' });
    expect(field(offset.host, 'automatic overscan')).toBeNull();
    await offset.close();
    const line = await renderDialog({ mode: 'line' });
    expect(field(line.host, 'automatic overscan')).toBeNull();
    await line.close();
  });
});
