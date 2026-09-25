import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { AddCncBitForm } from './AddCncBitForm';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// A tapered ball nose is entered the way sellers list it (ADR-368): the ball
// tip, the PER-SIDE taper, and the diameter where the flutes end. The stored
// included angle is twice the entered side angle.
const TOP_DIAMETER = 'New bit cut diameter at the top of the flutes (mm)';
const SIDE_ANGLE = 'New bit taper angle per side (deg)';
const BALL_TIP = 'New bit ball tip diameter (mm)';

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

async function unmount(host: HTMLDivElement, root: Root): Promise<void> {
  await act(async () => root.unmount());
  host.remove();
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

async function selectTaperedBall(host: HTMLElement): Promise<void> {
  const select = host.querySelector('[aria-label="New bit kind"]');
  if (!(select instanceof HTMLSelectElement)) throw new Error('kind select missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(select, 'tapered-ball-nose');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function add(host: HTMLElement): Promise<void> {
  const button = host.querySelector('[aria-label="Add bit"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('Add bit button missing');
  await act(async () => button.click());
}

describe('AddCncBitForm — tapered ball nose', () => {
  it('asks for the top diameter, per-side taper and ball tip instead of the V-bit fields', async () => {
    const { host, root } = await renderForm();
    try {
      await selectTaperedBall(host);
      expect(host.querySelector(`[aria-label="${TOP_DIAMETER}"]`)).toBeInstanceOf(HTMLInputElement);
      expect(host.querySelector(`[aria-label="${SIDE_ANGLE}"]`)).toBeInstanceOf(HTMLInputElement);
      expect(host.querySelector(`[aria-label="${BALL_TIP}"]`)).toBeInstanceOf(HTMLInputElement);
      expect(host.querySelector('[aria-label="New bit included angle (deg)"]')).toBeNull();
      expect(host.querySelector('[aria-label="New bit tip flat diameter (mm)"]')).toBeNull();
    } finally {
      await unmount(host, root);
    }
  });

  it('stores the doubled included angle and says where the modeled taper ends', async () => {
    const { host, root } = await renderForm();
    try {
      await selectTaperedBall(host);
      await setInput(host, 'New bit name', 'Carving TBN');
      await setInput(host, TOP_DIAMETER, '6.25');
      await setInput(host, SIDE_ANGLE, '5.4');
      await setInput(host, BALL_TIP, '1.5875');

      // Amana 46282's listing: a 1/16" ball at 5.4 degrees per side reaches
      // 6.25 mm at its 1" (25.4 mm) cutting length.
      expect(host.querySelector('[role="status"]')?.textContent).toBe(
        'Modeled taper reaches 6.25 mm about 25.4 mm above the tip (10.8° included). ' +
          'Compare with the listed cutting length.',
      );
      await add(host);

      expect(useStore.getState().cncLibrary.customTools[0]).toMatchObject({
        name: 'Carving TBN',
        kind: 'tapered-ball-nose',
        diameterMm: 6.25,
        tipAngleDeg: 10.8,
        tipDiameterMm: 1.5875,
      });
      expect(host.querySelector('[role="status"]')).toBeNull();
    } finally {
      await unmount(host, root);
    }
  });

  it('requires a ball tip smaller than the top diameter', async () => {
    const { host, root } = await renderForm();
    try {
      await selectTaperedBall(host);
      await setInput(host, 'New bit name', 'No tip');
      await setInput(host, TOP_DIAMETER, '6.35');
      await setInput(host, SIDE_ANGLE, '5.4');
      await add(host);
      expect(useStore.getState().cncLibrary.customTools).toEqual([]);
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        'Enter the ball tip diameter (twice the listed tip radius)',
      );

      await setInput(host, BALL_TIP, '6.35');
      await add(host);
      expect(useStore.getState().cncLibrary.customTools).toEqual([]);
      expect(host.querySelector('[role="status"]')).toBeNull();
    } finally {
      await unmount(host, root);
    }
  });

  it('rejects a taper per side outside 0.5 to 89.5 degrees', async () => {
    const { host, root } = await renderForm();
    try {
      await selectTaperedBall(host);
      await setInput(host, 'New bit name', 'Included angle typed');
      await setInput(host, TOP_DIAMETER, '6.35');
      await setInput(host, BALL_TIP, '1');
      await setInput(host, SIDE_ANGLE, '90');
      await add(host);

      expect(useStore.getState().cncLibrary.customTools).toEqual([]);
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        'Enter the actual taper angle per side from 0.5 to 89.5 degrees.',
      );
    } finally {
      await unmount(host, root);
    }
  });
});
