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

describe('Cut Settings scan pattern (ADR-492)', () => {
  it('applies an image scan angle, cross-hatch and angle per pass', async () => {
    const view = await renderDialog({ mode: 'image', passes: 3 });
    expect(view.host.querySelector('[aria-label="Image scan direction preview"]')).not.toBeNull();
    await change(requireField(view.host, 'image scan angle'), '45');
    await act(async () => requireField(view.host, 'image cross-hatch').click());
    await change(requireField(view.host, 'angle change per pass'), '15');
    await submit(view.form);
    expect(view.onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        imageScanAngleDeg: 45,
        imageCrossHatch: true,
        passAngleStepDeg: 15,
      }),
    );
    await view.close();
  });

  it('opens angles stored from elsewhere without blocking Apply', async () => {
    const view = await renderDialog({
      mode: 'image',
      imageScanAngleDeg: -45,
      passAngleStepDeg: 37.5,
    });
    expect(requireField(view.host, 'image scan angle').value).toBe('135');
    await submit(view.form);
    expect(view.onApply).toHaveBeenCalledWith(
      expect.objectContaining({ imageScanAngleDeg: 135, passAngleStepDeg: 37.5 }),
    );
    await view.close();
  });

  it('offers the angle per pass on hatched fills only', async () => {
    const scanline = await renderDialog({ mode: 'fill', fillStyle: 'scanline' });
    expect(field(scanline.host, 'angle change per pass')).not.toBeNull();
    expect(field(scanline.host, 'image scan angle')).toBeNull();
    await scanline.close();
    const offset = await renderDialog({ mode: 'fill', fillStyle: 'offset' });
    expect(field(offset.host, 'angle change per pass')).toBeNull();
    await offset.close();
    const line = await renderDialog({ mode: 'line' });
    expect(field(line.host, 'angle change per pass')).toBeNull();
    await line.close();
  });
});
