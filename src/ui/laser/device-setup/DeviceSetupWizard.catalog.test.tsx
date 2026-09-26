// Catalog-facing wizard behavior: the three-stage shell, the searchable
// profile catalog, and verbatim profile application.

import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { renderWizard } from './device-setup-wizard.test-support';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

describe('DeviceSetupWizard catalog', () => {
  it('opens machine type and searchable profiles together in a three-stage setup', async () => {
    const view = await renderWizard();
    try {
      expect(view.host.textContent).toContain('Step 1 of 3');
      expect(view.host.querySelectorAll('input[name="machine-capability"]')).toHaveLength(3);
      expect(view.host.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
      expect(
        view.host.querySelectorAll('nav[aria-label="Machine Setup steps"] button'),
      ).toHaveLength(3);
      expect(view.host.querySelectorAll('.lf-setup-profile')).toHaveLength(2);
      expect(view.host.querySelector('input[aria-label="Search machine profiles"]')).toBeInstanceOf(
        HTMLInputElement,
      );
      expect(view.host.textContent).not.toContain('ready to cut');
    } finally {
      await view.unmount();
    }
  });

  it('filters the profile catalog by search text', async () => {
    const view = await renderWizard();
    try {
      const search = input(view.host, 'Search machine profiles');
      await act(async () => {
        search.value = 'sculpfun';
        Simulate.change(search);
      });
      expect(view.host.textContent).toContain('Sculpfun S30');
      expect(view.host.textContent).not.toContain('Ortur Laser Master 3');
      await act(async () => {
        search.value = 'no such machine';
        Simulate.change(search);
      });
      expect(view.host.textContent).toContain('No profile matches');
    } finally {
      await view.unmount();
    }
  });

  it('shows the complete catalog on request', async () => {
    const view = await renderWizard();
    try {
      expect(view.host.querySelectorAll('.lf-setup-profile')).toHaveLength(2);
      await act(async () => button(view.host, 'Browse all').click());
      expect(view.host.querySelectorAll('.lf-setup-profile').length).toBeGreaterThan(2);
      expect(profileCard(view.host, 'Use Ortur Laser Master 3')).toBeInstanceOf(HTMLInputElement);
    } finally {
      await view.unmount();
    }
  });

  it('selects a profile from anywhere on its card, while profile details stay neutral', async () => {
    const view = await renderWizard();
    try {
      const search = input(view.host, 'Search machine profiles');
      await act(async () => {
        search.value = 'Sculpfun S30 (5 W, manual air)';
        Simulate.change(search);
      });
      const card = view.host.querySelector('article.lf-setup-profile');
      const radio = card?.querySelector('input[type="radio"]');
      if (!(radio instanceof HTMLInputElement)) throw new Error('Profile card control missing');
      const summary = card?.querySelector('summary');
      if (!(summary instanceof HTMLElement)) throw new Error('Profile details missing');

      await act(async () => summary.click());
      expect(radio.checked).toBe(false);

      const name = card?.querySelector('strong');
      if (!(name instanceof HTMLElement)) throw new Error('Profile name missing');
      await act(async () => name.click());
      expect(radio.checked).toBe(true);
      expect(card?.getAttribute('data-selected')).toBe('true');

      await act(async () => button(view.host, 'Check essentials').click());
      expect(input(view.host, 'Device name').value).toBe('Sculpfun S30 (5 W, manual air)');
    } finally {
      await view.unmount();
    }
  });

  it('offers the controller readback on the Machine stage instead of inside a disclosure', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedSettings: { bedWidth: 363, bedHeight: 273 },
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderWizard();
    try {
      const auto = view.host.querySelector('section[aria-label="Find my machine"]');
      if (!(auto instanceof HTMLElement)) throw new Error('Find my machine card missing');
      expect(auto.closest('details')).toBeNull();
      expect(auto.textContent).toMatch(/Bed width: .* → 363\.000 mm/);
      expect(view.host.querySelector('[role="status"]')).toBeNull();

      await act(async () => button(view.host, 'Use detected values').click());
      expect(view.host.querySelector('[role="status"]')?.textContent).toContain(
        'Detected values applied to this setup draft',
      );
      expect(useStore.getState().project.device.bedWidth).toBe(DEFAULT_DEVICE_PROFILE.bedWidth);

      await act(async () => button(view.host, 'Check essentials').click());
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
      const search = input(view.host, 'Search machine profiles');
      await act(async () => {
        search.value = 'Creality Falcon A1 Pro';
        Simulate.change(search);
      });
      await act(async () => profileCard(view.host, 'Use Creality Falcon A1 Pro').click());
      expect(select(view.host, 'Controller firmware').value).toBe('grblhal');
      await act(async () => button(view.host, 'Check essentials').click());
      expect(input(view.host, 'Bed width (mm)').value).toBe('358');
      expect(input(view.host, 'Bed height (mm)').value).toBe('268');
      expect(useStore.getState().project.device).toEqual(DEFAULT_DEVICE_PROFILE);
    } finally {
      await view.unmount();
    }
  });
});

/** The catalog card control: one radio per profile, the whole card is its label. */
function profileCard(host: HTMLElement, ariaLabel: string): HTMLInputElement {
  const card = [...host.querySelectorAll<HTMLInputElement>('.lf-setup-profile input')].find(
    (candidate) => candidate.getAttribute('aria-label')?.startsWith(ariaLabel),
  );
  if (!(card instanceof HTMLInputElement)) throw new Error(`Profile card missing: ${ariaLabel}`);
  return card;
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
      candidate.textContent?.includes(label) ||
      candidate.getAttribute('aria-label')?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
