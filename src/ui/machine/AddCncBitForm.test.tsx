import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { AddCncBitForm } from './AddCncBitForm';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetStore();
  useStore.setState({ cncLibrary: { customTools: [], feedPresets: [], machineProfiles: [] } });
  useStore.getState().setMachineKind('cnc');
});

afterEach(resetStore);

async function renderForm(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<AddCncBitForm />));
  return { host, root };
}

async function setInput(host: HTMLElement, label: string, value: string): Promise<void> {
  const input = host.querySelector(`[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function selectKind(host: HTMLElement, value: string): Promise<void> {
  const select = host.querySelector('[aria-label="New bit kind"]');
  if (!(select instanceof HTMLSelectElement)) throw new Error('kind select missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function add(host: HTMLElement): Promise<void> {
  const button = host.querySelector('[aria-label="Add bit"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('Add bit button missing');
  await act(async () => button.click());
}

describe('AddCncBitForm', () => {
  it('does not prefill geometry or accept an angle-driven bit without its actual angle', async () => {
    const { host, root } = await renderForm();
    try {
      const diameter = host.querySelector('[aria-label="New bit diameter (mm)"]');
      expect(diameter).toBeInstanceOf(HTMLInputElement);
      expect((diameter as HTMLInputElement).value).toBe('');

      await selectKind(host, 'v-bit');
      const angle = host.querySelector('[aria-label="New bit included angle (deg)"]');
      expect(angle).toBeInstanceOf(HTMLInputElement);
      expect((angle as HTMLInputElement).value).toBe('');

      await setInput(host, 'New bit name', 'Shop V-bit');
      await setInput(host, 'New bit diameter (mm)', '3');
      await add(host);
      expect(useStore.getState().cncLibrary.customTools).toEqual([]);
      expect(host.textContent).toContain('Enter the actual included angle');

      await setInput(host, 'New bit included angle (deg)', '0.5');
      await add(host);
      expect(useStore.getState().cncLibrary.customTools).toEqual([]);
      expect(host.textContent).toContain('from 1 to 179 degrees');

      await setInput(host, 'New bit included angle (deg)', '90');
      await setInput(host, 'New bit diameter (mm)', '0.01');
      await add(host);
      expect(useStore.getState().cncLibrary.customTools).toEqual([]);
      expect(host.textContent).toContain('from 0.1 to 50 mm');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('stores the entered 3 mm / 90 degree geometry and clears it after Add', async () => {
    const { host, root } = await renderForm();
    try {
      await setInput(host, 'New bit name', '90 degree 3 mm V-bit');
      await selectKind(host, 'v-bit');
      await setInput(host, 'New bit diameter (mm)', '3');
      await setInput(host, 'New bit included angle (deg)', '90');
      await add(host);

      expect(useStore.getState().cncLibrary.customTools[0]).toMatchObject({
        name: '90 degree 3 mm V-bit',
        kind: 'v-bit',
        diameterMm: 3,
        tipAngleDeg: 90,
      });
      expect((host.querySelector('[aria-label="New bit name"]') as HTMLInputElement).value).toBe(
        '',
      );
      expect(
        (host.querySelector('[aria-label="New bit diameter (mm)"]') as HTMLInputElement).value,
      ).toBe('');
      expect(
        (host.querySelector('[aria-label="New bit included angle (deg)"]') as HTMLInputElement)
          .value,
      ).toBe('');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
