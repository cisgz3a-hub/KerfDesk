import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { mockPlatform, renderWizard } from './device-setup-wizard.test-support';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(resetTestState);
afterEach(resetTestState);

describe('DeviceSetupWizard detected values', () => {
  it('confirms applied values, keeps them draft-only, and clears confirmation on a new read', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedSettings: { bedWidth: 363, bedHeight: 273 },
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderWizard();
    try {
      expect(view.host.querySelector('[role="status"]')).toBeNull();

      await act(async () => button(view.host, 'Use detected values').click());
      expect(view.host.querySelector('[role="status"]')?.textContent).toContain(
        'Detected values applied to this setup draft',
      );
      expect(useStore.getState().project.device.bedWidth).toBe(DEFAULT_DEVICE_PROFILE.bedWidth);

      await act(async () => {
        useLaserStore.setState({
          detectedSettings: { bedWidth: 364, bedHeight: 274 },
          lastSettingsReadAt: 2,
        } as Partial<ReturnType<typeof useLaserStore.getState>>);
      });
      expect(view.host.querySelector('[role="status"]')).toBeNull();

      await act(async () => button(view.host, 'Next').click());
      expect(input(view.host, 'Bed width (mm)').value).toBe('363');
    } finally {
      await view.unmount();
    }
  });

  // ADR-420: a machine that has not been through setup is filled in by itself,
  // lists each change, and one Undo restores the draft; nothing is saved.
  it('fills a new machine from its controller and undoes the fill in one click', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedSettings: { bedWidth: 363, bedHeight: 273, laserModeEnabled: true },
      connectedBaudRate: 230400,
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderWizard(undefined, mockPlatform(), { newMachine: true });
    try {
      const filled = view.host.querySelector('.lf-setup-found-filled');
      expect(filled?.textContent).toContain('Filled in from your controller');
      expect(filled?.textContent).toContain('Baud rate set to 230400');
      expect(filled?.textContent).toMatch(/Bed width: .* → 363/);
      expect(useStore.getState().project.device.bedWidth).toBe(DEFAULT_DEVICE_PROFILE.bedWidth);

      await act(async () => button(view.host, 'Undo').click());
      expect(view.host.querySelector('.lf-setup-found-filled')).toBeNull();
      expect(view.host.textContent).toContain('Your setup is back as it was');
      await act(async () => button(view.host, 'Next').click());
      expect(input(view.host, 'Bed width (mm)').value).toBe(
        String(DEFAULT_DEVICE_PROFILE.bedWidth),
      );
    } finally {
      await view.unmount();
    }
  });

  // ADR-637 Amendment 2 (controller audit v4 E2-P2-1): Sculpfun's firmware
  // reports 400 × 410 mm of travel for the S30's 380 × 385 mm work area.
  it('keeps a listed machine’s work area and shows the controller’s travel to review', async () => {
    const view = await renderWizard(undefined, mockPlatform(), { newMachine: true });
    try {
      const s30 = () => radio(view.host, 'Use Sculpfun S30 (5 W, stock automatic air)');
      await act(async () => s30().click());
      await act(async () => {
        useLaserStore.setState({
          connection: { kind: 'connected' },
          detectedSettings: { bedWidth: 400, bedHeight: 410, maxFeed: 10000 },
          lastSettingsReadAt: 1,
        } as Partial<ReturnType<typeof useLaserStore.getState>>);
      });
      const filled = view.host.querySelector('.lf-setup-found-filled');
      expect(filled?.textContent).toContain('Filled in from your controller');
      expect(filled?.textContent).not.toContain('Bed width');
      expect(filled?.textContent).not.toContain('Bed height');
      const kept = filled?.querySelector('.lf-setup-kept-area')?.textContent;
      expect(kept).toContain('Work area kept at 380 × 385 mm');
      expect(kept).toContain('($130 × $131) is 400 × 410 mm');
      expect(s30().checked).toBe(true);

      await act(async () => button(view.host, 'Next').click());
      expect(input(view.host, 'Bed width (mm)').value).toBe('380');
      expect(input(view.host, 'Bed height (mm)').value).toBe('385');
    } finally {
      await view.unmount();
    }
  });

  // Setup saved for either head counts: its signatures differ since ADR-416.
  it.each(['laser', 'cnc'] as const)(
    'keeps a machine already set up (%s) as it is until Use detected values',
    async (configuredAs) => {
      useLaserStore.setState({
        connection: { kind: 'connected' },
        detectedSettings: { bedWidth: 363, bedHeight: 273 },
        lastSettingsReadAt: 1,
      } as Partial<ReturnType<typeof useLaserStore.getState>>);
      const view = await renderWizard(undefined, mockPlatform(), { configuredAs });
      try {
        expect(view.host.querySelector('.lf-setup-found-filled')).toBeNull();
        expect(view.host.textContent).toContain('Your controller reports values that differ');
        await act(async () => button(view.host, 'Next').click());
        expect(input(view.host, 'Bed width (mm)').value).toBe(
          String(DEFAULT_DEVICE_PROFILE.bedWidth),
        );
      } finally {
        await view.unmount();
      }
    },
  );
});

function resetTestState(): void {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    detectedSettings: null,
    detectedControllerKind: null,
    activeControllerKind: 'grbl-v1.1',
    lastSettingsReadAt: null,
    connectedBaudRate: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
}

function input(host: HTMLElement, ariaLabel: string): HTMLInputElement {
  const field = host.querySelector(`input[aria-label="${ariaLabel}"]`);
  if (!(field instanceof HTMLInputElement)) throw new Error(`Input missing: ${ariaLabel}`);
  return field;
}

function radio(host: HTMLElement, ariaLabel: string): HTMLInputElement {
  const match = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
    (candidate) => candidate.getAttribute('aria-label')?.startsWith(ariaLabel),
  );
  if (!(match instanceof HTMLInputElement)) throw new Error(`Radio missing: ${ariaLabel}`);
  return match;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
