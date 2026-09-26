import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { openSetupDisclosure } from './device-setup-test-helpers';
import { renderWizard } from './device-setup-wizard.test-support';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    detectedControllerKind: null,
    detectedSettings: null,
    controllerSettings: null,
    lastSettingsReadAt: null,
  });
});

describe('DeviceSetupWizard router commit', () => {
  it('applies accepted settings without replacing the user-selected firmware profile', async () => {
    useStore.getState().setMachineKind('cnc');
    const originalMaxPowerS = useStore.getState().project.device.maxPowerS;
    const originalControllerKind = useStore.getState().project.device.controllerKind;
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedControllerKind: 'grblhal',
      // CNC mode allows an explicit S-to-RPM mapping; it does not establish it.
      detectedSettings: {
        maxPowerS: 24000,
        bedWidth: 750,
        bedHeight: 610,
        laserModeEnabled: false,
      },
      controllerSettings: {
        maxPowerS: 24000,
        bedWidth: 750,
        bedHeight: 610,
        laserModeEnabled: false,
      },
      lastSettingsReadAt: 1718600000000,
    });
    const view = await renderWizard();
    try {
      await act(async () => input(view.host, 'Use S maximum as spindle RPM').click());
      await act(async () => button(view.host, 'Use detected values').click());
      await act(async () => button(view.host, 'Check essentials').click());
      expect(input(view.host, 'Bed width (mm)').value).toBe('750');
      expect(input(view.host, 'Spindle maximum').value).toBe('24000');
      expect(view.host.querySelector('input[aria-label="GRBL $30 max power S"]')).toBeNull();

      await act(async () => button(view.host, 'Review setup').click());
      await act(async () => button(view.host, 'Save CNC machine setup').click());

      const state = useStore.getState();
      const machine = state.project.machine;
      if (machine?.kind !== 'cnc') throw new Error('expected CNC machine');
      expect(state.project.device).toMatchObject({
        bedWidth: 750,
        bedHeight: 610,
        maxPowerS: originalMaxPowerS,
      });
      expect(state.project.device.controllerKind).toBe(originalControllerKind);
      expect(machine.params.spindleMaxRpm).toBe(24000);
      expect(state.project.workspace).toMatchObject({ width: 750, height: 610 });
    } finally {
      await view.unmount();
    }
  });

  it('clears controller-read values after a real disconnect', async () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateCncMachine({ params: { spindleMaxRpm: 12000 } });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedControllerKind: 'grblhal',
      detectedSettings: { maxPowerS: 24000, bedWidth: 750, bedHeight: 610 },
      lastSettingsReadAt: 1718600000000,
    });
    const view = await renderWizard();
    try {
      await act(async () => {
        useLaserStore.setState({
          connection: { kind: 'disconnected' },
          detectedControllerKind: null,
          detectedSettings: null,
          lastSettingsReadAt: null,
        });
      });
      expect(view.host.textContent).toContain('Find your machine');
      expect(view.host.textContent).not.toContain('Use detected values');
      await act(async () => button(view.host, 'Check essentials').click());
      expect(input(view.host, 'Bed width (mm)').value).not.toBe('750');
      expect(input(view.host, 'Spindle maximum').value).toBe('12000');
    } finally {
      await view.unmount();
    }
  });

  // CN-4 (2026-09-25 controller audit): the dialect choice shapes laser output
  // only; CNC output is byte-identical for every choice.
  it('names the output dialect as the laser dialect when the setup includes CNC', async () => {
    useStore.getState().setMachineKind('cnc');
    const view = await renderWizard();
    try {
      await openSetupDisclosure(view.host, 'Connection options');
      expect(view.host.querySelector('[aria-label="Laser G-code output dialect"]')).not.toBeNull();
      expect(view.host.querySelector('[aria-label="G-code output dialect"]')).toBeNull();
      expect(view.host.textContent).toContain('Laser output dialect');
      expect(view.host.textContent).toContain(
        "CNC programs always use KerfDesk's GRBL CNC dialect.",
      );
    } finally {
      await view.unmount();
    }
  });

  // CN-2: the controller list says which controllers cannot run CNC jobs.
  it('marks the controllers that cannot run CNC jobs as laser only when the setup includes CNC', async () => {
    useStore.getState().setMachineKind('cnc');
    const view = await renderWizard();
    try {
      await openSetupDisclosure(view.host, 'Connection options');
      expect(controllerOptionLabels(view.host)).toEqual([
        'GRBL v1.1',
        'grblHAL',
        'FluidNC',
        'Marlin — laser only',
        'Smoothieware — laser only',
        'Ruida (.rd export) — laser only',
      ]);
    } finally {
      await view.unmount();
    }
  });

  it('lists controllers by name alone in a laser-only setup', async () => {
    const view = await renderWizard();
    try {
      await openSetupDisclosure(view.host, 'Connection options');
      expect(controllerOptionLabels(view.host)).toContain('Marlin');
      expect(controllerOptionLabels(view.host).join()).not.toContain('laser only');
    } finally {
      await view.unmount();
    }
  });
});

function controllerOptionLabels(host: HTMLElement): ReadonlyArray<string> {
  const select = host.querySelector('select[aria-label="Controller firmware"]');
  if (!(select instanceof HTMLSelectElement)) throw new Error('controller select missing');
  return [...select.options].map((option) => option.textContent ?? '');
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button missing: ${label}`);
  return match;
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const match = host.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`input missing: ${label}`);
  return match;
}
