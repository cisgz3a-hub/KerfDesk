import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, type Layer } from '../../core/scene';
import { resetStore } from '../state/test-helpers';
import { CutSettingsDialog } from './CutSettingsDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetStore());

async function renderDialog(patch: Partial<Layer>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onApply = vi.fn();
  const layer = {
    ...createLayer({ id: 'test', color: '#000000' }),
    mode: 'line' as const,
    ...patch,
  };
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

function control<T extends Element>(host: HTMLElement, label: string): T {
  const element = host.querySelector<T>(`[aria-label="Cut settings ${label}"]`);
  if (element === null) throw new Error(`missing ${label}`);
  return element;
}

async function change(element: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function apply(form: HTMLFormElement): Promise<void> {
  expect(form.checkValidity()).toBe(true);
  await act(async () => form.requestSubmit());
}

describe('Cut Settings lead-in and lead-out (ADR-626)', () => {
  it('starts off, with an arc of 2 mm at 90° on the scrap side', async () => {
    const view = await renderDialog({});
    expect(control<HTMLInputElement>(view.host, 'enable lead-in').checked).toBe(false);
    expect(control<HTMLInputElement>(view.host, 'enable lead-out').checked).toBe(false);
    expect(control<HTMLSelectElement>(view.host, 'lead style').value).toBe('arc');
    expect(control<HTMLInputElement>(view.host, 'lead length').value).toBe('2');
    expect(control<HTMLInputElement>(view.host, 'lead angle').value).toBe('90');
    expect(control<HTMLSelectElement>(view.host, 'lead side').value).toBe('auto');
    // Saving without touching them leaves an operation that never had leads
    // without lead fields, so it still matches its linked recipe.
    await apply(view.form);
    expect(view.onApply.mock.calls[0]?.[0]).not.toHaveProperty('leadInEnabled');
    expect(view.onApply.mock.calls[0]?.[0]).not.toHaveProperty('leadStyle');
    await view.close();
  });

  it('keeps an operation with leads switched off as it is', async () => {
    const view = await renderDialog({ leadInEnabled: true, leadLengthMm: 3 });
    await act(async () => control<HTMLInputElement>(view.host, 'enable lead-in').click());
    await apply(view.form);
    expect(view.onApply).toHaveBeenCalledWith(
      expect.objectContaining({ leadInEnabled: false, leadOutEnabled: false, leadLengthMm: 3 }),
    );
    await view.close();
  });

  it('applies the leads it is given, and a line lead keeps to 90° or less', async () => {
    const view = await renderDialog({});
    await act(async () => {
      control<HTMLInputElement>(view.host, 'enable lead-in').click();
      control<HTMLInputElement>(view.host, 'enable lead-out').click();
    });
    await change(control<HTMLSelectElement>(view.host, 'lead style'), 'line');
    // The angle box now holds the line default.
    expect(control<HTMLInputElement>(view.host, 'lead angle').value).toBe('45');
    expect(control<HTMLInputElement>(view.host, 'lead angle').max).toBe('90');
    await change(control<HTMLInputElement>(view.host, 'lead length'), '3.5');
    await change(control<HTMLInputElement>(view.host, 'lead angle'), '30');
    await change(control<HTMLSelectElement>(view.host, 'lead side'), 'inside');
    await apply(view.form);
    expect(view.onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        leadInEnabled: true,
        leadOutEnabled: true,
        leadStyle: 'line',
        leadLengthMm: 3.5,
        leadAngleDeg: 30,
        leadSide: 'inside',
      }),
    );
    await view.close();
  });

  it('shows the stored leads and clamps a typed length', async () => {
    const view = await renderDialog({
      leadInEnabled: true,
      leadStyle: 'arc',
      leadLengthMm: 4,
      leadAngleDeg: 120,
      leadSide: 'outside',
    });
    expect(control<HTMLInputElement>(view.host, 'enable lead-in').checked).toBe(true);
    expect(control<HTMLInputElement>(view.host, 'lead angle').value).toBe('120');
    const length = control<HTMLInputElement>(view.host, 'lead length');
    await change(length, '99');
    await act(async () => length.removeAttribute('max'));
    await apply(view.form);
    expect(view.onApply).toHaveBeenCalledWith(
      expect.objectContaining({ leadLengthMm: 20, leadAngleDeg: 120, leadSide: 'outside' }),
    );
    await view.close();
  });
});
