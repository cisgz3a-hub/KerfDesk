// Machine-stage wizard behavior (ADR-637): the three-stage shell with one Next,
// the searchable machine list, "My machine isn't listed", and verbatim profile
// application.

import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { CNC_MACHINE_CATALOG } from '../../../core/cnc';
import { DEFAULT_DEVICE_PROFILE, GRBL_MACHINE_PROFILE_CATALOG } from '../../../core/devices';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { renderWizard } from './device-setup-wizard.test-support';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOT_LISTED = 'My machine isn’t listed';

afterEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    detectedSettings: null,
    detectedControllerKind: null,
    activeControllerKind: 'grbl-v1.1',
    statusReport: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('DeviceSetupWizard machine list', () => {
  it('opens on every listed machine with one Next in a three-stage setup', async () => {
    const view = await renderWizard();
    try {
      expect(view.host.textContent).toContain('Step 1 of 3');
      expect(view.host.textContent).toContain('Which machine do you have?');
      expect(view.host.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
      expect(
        view.host.querySelectorAll('nav[aria-label="Machine Setup steps"] button'),
      ).toHaveLength(3);
      // Withdrawn presets stay in the catalog for saved copies only (ADR-660).
      const brandLasers = GRBL_MACHINE_PROFILE_CATALOG.filter(
        (entry) => entry.profile.vendor !== 'Generic' && entry.withdrawn === undefined,
      );
      expect(machineRows(view.host)).toHaveLength(brandLasers.length + CNC_MACHINE_CATALOG.length);
      expect(input(view.host, 'Search machines')).toBeInstanceOf(HTMLInputElement);
      // Nothing is chosen yet, so neither the type nor a selection is asked.
      expect(view.host.querySelector('input[name="setup-machine"]:checked')).toBeNull();
      expect(view.host.querySelectorAll('input[name="machine-capability"]')).toHaveLength(0);
      const footer = view.host.querySelector('.lf-setup-footer');
      expect(footerLabels(footer)).toEqual(['Cancel without saving', 'Next']);
      expect(view.host.textContent).not.toContain('ready to cut');
    } finally {
      await view.unmount();
    }
  });

  it('filters the list by search text and by machine type', async () => {
    const view = await renderWizard();
    try {
      await search(view.host, 'sculpfun');
      expect(view.host.textContent).toContain('S30 (5 W, manual air)');
      expect(view.host.textContent).not.toContain('Laser Master 3');
      await search(view.host, 'no such machine');
      expect(view.host.textContent).toContain('No machine matches');
      expect(radio(view.host, NOT_LISTED)).toBeInstanceOf(HTMLInputElement);

      await search(view.host, '');
      await act(async () => filter(view.host, 'CNC').click());
      expect(radio(view.host, 'Use Shapeoko 3 XXL')).toBeInstanceOf(HTMLInputElement);
      expect(view.host.textContent).not.toContain('Laser Master 3');
      // The Laser + CNC Neotronics shows under both types.
      expect(radio(view.host, 'Use Neotronics 4040 Max / LT-4LDS-V2 20W')).toBeInstanceOf(
        HTMLInputElement,
      );
    } finally {
      await view.unmount();
    }
  });

  it('reviews the draft in the names its editors use, not stored identifiers', async () => {
    const view = await renderWizard();
    try {
      await act(async () => button(view.host, 'Go to step 3').click());
      expect(view.host.textContent).toContain('Step 3 of 3');
      const review = view.host.querySelector('.lf-setup-content')?.textContent ?? '';
      expect(review).toContain('Front left');
      expect(review).toContain('Buffered receive window, ');
      expect(review).not.toMatch(/front-left|char-counted|grbl-dynamic/);
      expect(view.host.querySelector('.lf-setup-summary')?.textContent).toContain('Front left');
    } finally {
      await view.unmount();
    }
  });

  it('selects a machine from anywhere on its row and shows what it brings', async () => {
    const view = await renderWizard();
    try {
      const row = radio(view.host, 'Use Sculpfun S30 (5 W, manual air)');
      const name = row.closest('label')?.querySelector('.lf-setup-picker-name');
      if (!(name instanceof HTMLElement)) throw new Error('Machine name missing');
      await act(async () => name.click());
      expect(row.checked).toBe(true);
      expect(row.closest('label')?.getAttribute('data-selected')).toBe('true');
      const details = view.host.querySelector('section[aria-label="Chosen machine"]');
      expect(details?.textContent).toContain('380 × 385 mm');
      expect(details?.textContent).toContain('Profile details');

      await act(async () => button(view.host, 'Next').click());
      expect(input(view.host, 'Device name').value).toBe('Sculpfun S30 (5 W, manual air)');
    } finally {
      await view.unmount();
    }
  });

  it('asks type, work area and firmware only for a machine that is not listed', async () => {
    const view = await renderWizard();
    try {
      await act(async () => radio(view.host, 'Use Ortur Laser Master 3 (LU2-10A, 10 W)').click());
      await act(async () => radio(view.host, NOT_LISTED).click());
      expect(radio(view.host, NOT_LISTED).checked).toBe(true);
      expect(view.host.querySelector('input[name="setup-machine"]:checked')).toBe(
        radio(view.host, NOT_LISTED),
      );
      // It starts again from the generic starter, keeping the work area.
      expect(input(view.host, 'Machine name').value).toBe('My machine');
      expect(input(view.host, 'Work area width (mm)').value).toBe('400');
      expect(view.host.querySelectorAll('input[name="machine-capability"]')).toHaveLength(3);

      await act(async () => radio(view.host, 'CNC only').click());
      // The Ortur preset is grblHAL (ADR-660), so choose another firmware.
      expect(select(view.host, 'Controller firmware').value).toBe('grblhal');
      await changeSelect(view.host, 'Firmware', 'grbl-v1.1');
      // One draft value: Connection options shows the same controller.
      expect(select(view.host, 'Controller firmware').value).toBe('grbl-v1.1');
      expect(view.host.querySelector('.lf-setup-summary')?.textContent).toContain('CNC');

      await act(async () => button(view.host, 'Next').click());
      expect(view.host.textContent).toContain('CNC job setup');
      expect(useStore.getState().project.device).toEqual(DEFAULT_DEVICE_PROFILE);
    } finally {
      await view.unmount();
    }
  });

  it('chooses a CNC machine from the same list', async () => {
    const view = await renderWizard();
    try {
      await act(async () => radio(view.host, 'Use Shapeoko 3 (Standard)').click());
      expect(view.host.textContent).toContain('Geometry and spindle ceiling only: 30000 RPM');
      expect(view.host.querySelector('.lf-setup-summary')?.textContent).toContain('CNC');
      await act(async () => button(view.host, 'Next').click());
      expect(input(view.host, 'Bed width (mm)').value).toBe('425');
      expect(view.host.textContent).toContain('CNC job setup');
    } finally {
      await view.unmount();
    }
  });

  it('offers the controller readback in the connection strip', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedSettings: { bedWidth: 363, bedHeight: 273 },
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderWizard();
    try {
      const strip = view.host.querySelector('section[aria-label="Controller connection"]');
      if (!(strip instanceof HTMLElement)) throw new Error('Connection strip missing');
      expect(strip.closest('details')).toBeNull();
      expect(strip.textContent).toMatch(/Bed width: .* → 363\.000 mm/);
      expect(view.host.querySelector('[role="status"]')).toBeNull();

      await act(async () => button(view.host, 'Use detected values').click());
      expect(view.host.querySelector('[role="status"]')?.textContent).toContain(
        'Detected values applied to this setup draft',
      );
      expect(useStore.getState().project.device.bedWidth).toBe(DEFAULT_DEVICE_PROFILE.bedWidth);
      // Values of its own make it a machine that isn't listed, ready to name.
      expect(radio(view.host, NOT_LISTED).checked).toBe(true);

      await act(async () => button(view.host, 'Next').click());
      expect(input(view.host, 'Bed width (mm)').value).toBe('363');
    } finally {
      await view.unmount();
    }
  });

  it('keeps a selected catalog profile exact instead of overlaying controller observations', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedControllerKind: 'grblhal',
      detectedSettings: { bedWidth: 363, bedHeight: 273 },
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderWizard();
    try {
      const falcon = radio(view.host, 'Use Creality Falcon A1 Pro');
      // A firmware hint, never an identification (ADR-240).
      expect(falcon.closest('label')?.textContent).toContain('Same firmware');
      // The LM3 runs Ortur's grblHAL-based OLF 2.x (ADR-660).
      expect(
        radio(view.host, 'Use Ortur Laser Master 3 (LU2-10A, 10 W)').closest('label')?.textContent,
      ).toContain('Same firmware');
      expect(radio(view.host, 'Use xTool D1 Pro (20 W)').closest('label')?.textContent).toContain(
        'Other firmware',
      );
      await act(async () => falcon.click());
      expect(select(view.host, 'Controller firmware').value).toBe('grblhal');
      await act(async () => button(view.host, 'Next').click());
      expect(input(view.host, 'Bed width (mm)').value).toBe('358');
      expect(input(view.host, 'Bed height (mm)').value).toBe('268');
      expect(useStore.getState().project.device).toEqual(DEFAULT_DEVICE_PROFILE);
    } finally {
      await view.unmount();
    }
  });
});

function machineRows(host: HTMLElement): ReadonlyArray<HTMLInputElement> {
  return [
    ...host.querySelectorAll<HTMLInputElement>('.lf-setup-picker-list input[name="setup-machine"]'),
  ];
}

/** A machine row or other radio, by the start of its accessible name. */
function radio(host: HTMLElement, ariaLabel: string): HTMLInputElement {
  const match = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
    (candidate) => candidate.getAttribute('aria-label')?.startsWith(ariaLabel),
  );
  if (!(match instanceof HTMLInputElement)) throw new Error(`Radio missing: ${ariaLabel}`);
  return match;
}

function filter(host: HTMLElement, label: string): HTMLInputElement {
  const match = [
    ...host.querySelectorAll<HTMLInputElement>('input[name="setup-machine-kind-filter"]'),
  ].find((candidate) => candidate.closest('label')?.textContent === label);
  if (!(match instanceof HTMLInputElement)) throw new Error(`Filter missing: ${label}`);
  return match;
}

async function search(host: HTMLElement, text: string): Promise<void> {
  const field = input(host, 'Search machines');
  await act(async () => {
    field.value = text;
    Simulate.change(field);
  });
}

async function changeSelect(host: HTMLElement, ariaLabel: string, value: string): Promise<void> {
  const field = select(host, ariaLabel);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

function footerLabels(footer: Element | null): ReadonlyArray<string> {
  return [...(footer?.querySelectorAll('button') ?? [])].map(
    (candidate) => candidate.textContent?.trim() ?? '',
  );
}

function select(host: HTMLElement, ariaLabel: string): HTMLSelectElement {
  const field = host.querySelector(`select[aria-label="${ariaLabel}"]`);
  if (!(field instanceof HTMLSelectElement)) throw new Error(`Select missing: ${ariaLabel}`);
  return field;
}

function input(host: HTMLElement, ariaLabel: string): HTMLInputElement {
  const field = host.querySelector(`input[aria-label="${ariaLabel}"]`);
  if (!(field instanceof HTMLInputElement)) throw new Error(`Input missing: ${ariaLabel}`);
  return field;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) =>
      candidate.textContent?.trim() === label ||
      candidate.getAttribute('aria-label')?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
