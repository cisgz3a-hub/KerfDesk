// UX audit U8-P2-1 / U8-P3-5 (ADR-637 Amendment 7): a diode laser whose stock
// GRBL controller has laser mode off ($32=0) used to be set up as a CNC on the
// first Connect, and Start then fired M3 S12000 with a 3 s dwell. The type now
// stays Laser, the card asks to turn laser mode on and does it in one click
// (backup, confirm, guarded write), and CNC is only the operator's own answer.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../../core/controllers/grbl/grbl-settings';
import type { FileSaveRequest, PlatformAdapter } from '../../../platform/types';
import { useStore } from '../../state';
import { jobAwareConfirm } from '../../state/job-aware-dialogs';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { useToastStore } from '../../state/toast-store';
import { LASER_MODE_CONFIRMED_MESSAGE } from '../laser-mode-write';
import { mockPlatform, renderWizard } from './device-setup-wizard.test-support';
import {
  LASER_MODE_NOT_CHANGED_NO_BACKUP,
  LASER_MODE_OFF_QUESTION,
  setupLaserModePrompt,
} from './DeviceSetupLaserModeOff';

vi.mock('../../state/job-aware-dialogs', () => ({
  jobAwareConfirm: vi.fn(() => true),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalWrite = useLaserStore.getState().writeGrblSetting;
const originalCapabilities = useLaserStore.getState().capabilities;

beforeEach(resetTestState);
afterEach(resetTestState);

// A stock GRBL 1.1h diode controller: $32=0 is gnea/grbl's default.
function connectStockGrbl(laserMode: 0 | 1 = 0): void {
  const rows = settingsMapToRows(
    new Map([
      [30, '1000'],
      [31, '0'],
      [32, String(laserMode)],
      [110, '6000'],
      [130, '400'],
      [131, '410'],
    ]),
  );
  useLaserStore.setState({
    connection: { kind: 'connected' },
    statusReport: { state: 'Idle' },
    detectedSettings: {
      bedWidth: 400,
      bedHeight: 410,
      maxFeed: 6000,
      maxPowerS: 1000,
      minPowerS: 0,
      laserModeEnabled: laserMode === 1,
    },
    controllerSettings: { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: laserMode === 1 },
    grblSettingsRows: rows,
    lastSettingsReadAt: laserMode === 1 ? 2 : 1,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
}

/** A platform whose save picker stores the backup, as the user's Save would. */
function savingPlatform(): { readonly platform: PlatformAdapter; readonly saved: string[] } {
  const saved: string[] = [];
  const platform: PlatformAdapter = {
    ...mockPlatform(),
    pickFileForSave: vi.fn(async (_request: FileSaveRequest) => ({
      displayName: 'kerfdesk-grbl-settings.lfgrbl-settings.json',
      write: async (text: string) => {
        saved.push(text);
      },
    })) as unknown as PlatformAdapter['pickFileForSave'],
  };
  return { platform, saved };
}

describe('Machine Setup with laser mode off ($32=0)', () => {
  it('keeps a generic laser a laser and turns laser mode on in one click', async () => {
    connectStockGrbl(0);
    // The guarded write reads $$ back; here the controller now reports $32=1.
    const write = vi.fn(async () => connectStockGrbl(1));
    useLaserStore.setState({ writeGrblSetting: write });
    const { platform, saved } = savingPlatform();
    const view = await renderWizard(undefined, platform, { newMachine: true });
    try {
      const card = view.host.querySelector('.lf-setup-laser-mode-off');
      expect(card?.textContent).toContain(LASER_MODE_OFF_QUESTION);
      expect(view.host.textContent).not.toContain('Machine type set to');
      expect(view.host.textContent).not.toContain('CNC Machine Setup');
      // The laser keeps expecting laser mode on, so no "Enabled → Disabled" row.
      expect(view.host.querySelector('.lf-setup-found-filled')?.textContent).not.toContain(
        'Laser mode ($32)',
      );

      await act(async () => button(view.host, 'Turn on laser mode ($32=1)').click());

      expect(saved).toHaveLength(1);
      expect(saved[0]).toContain('"code": "$32"');
      expect(jobAwareConfirm).toHaveBeenCalledWith(
        setupLaserModePrompt('kerfdesk-grbl-settings.lfgrbl-settings.json'),
      );
      expect(write).toHaveBeenCalledExactlyOnceWith(32, '1');
      expect(useToastStore.getState().toasts.at(-1)?.message).toBe(LASER_MODE_CONFIRMED_MESSAGE);
      expect(view.host.querySelector('.lf-setup-laser-mode-off')).toBeNull();
    } finally {
      await view.unmount();
    }
  });

  it('writes nothing without a saved backup or a confirm', async () => {
    connectStockGrbl(0);
    const write = vi.fn(async () => undefined);
    useLaserStore.setState({ writeGrblSetting: write });
    const view = await renderWizard(undefined, mockPlatform(), { newMachine: true });
    try {
      await act(async () => button(view.host, 'Turn on laser mode ($32=1)').click());
      expect(write).not.toHaveBeenCalled();
      expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
        LASER_MODE_NOT_CHANGED_NO_BACKUP,
      );
    } finally {
      await view.unmount();
    }

    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    const declined = await renderWizard(undefined, savingPlatform().platform, {
      newMachine: true,
    });
    try {
      await act(async () => button(declined.host, 'Turn on laser mode ($32=1)').click());
      expect(write).not.toHaveBeenCalled();
    } finally {
      await declined.unmount();
    }
  });

  // The refuter's dead end: a listed laser chosen before Connect recorded laser
  // mode Off and offered no $32=1 at all.
  it('asks a listed laser chosen before Connect too, and keeps it expecting laser mode on', async () => {
    const view = await renderWizard(undefined, mockPlatform(), { newMachine: true });
    try {
      await act(async () =>
        radio(view.host, 'Use Sculpfun S30 (5 W, stock automatic air)').click(),
      );
      await act(async () => connectStockGrbl(0));
      expect(view.host.querySelector('.lf-setup-laser-mode-off')?.textContent).toContain(
        LASER_MODE_OFF_QUESTION,
      );
      expect(view.host.textContent).not.toContain('Enabled → Disabled');
      await act(async () => button(view.host, 'Next').click());
      expect(input(view.host, 'GRBL $32 laser mode enabled').checked).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  it('makes it a CNC only when the operator says so', async () => {
    connectStockGrbl(0);
    const view = await renderWizard(undefined, mockPlatform(), { newMachine: true });
    try {
      await act(async () => button(view.host, 'This is a CNC router').click());
      expect(view.host.querySelector('.lf-setup-laser-mode-off')).toBeNull();
      expect(document.body.textContent).toContain('CNC Machine Setup');
    } finally {
      await view.unmount();
    }
  });

  it('leaves a router chosen in the open project alone', async () => {
    useStore.getState().setMachineKind('cnc');
    connectStockGrbl(0);
    const view = await renderWizard(undefined, mockPlatform(), { newMachine: true });
    try {
      expect(view.host.querySelector('.lf-setup-laser-mode-off')).toBeNull();
      expect(document.body.textContent).toContain('CNC Machine Setup');
    } finally {
      await view.unmount();
    }
  });

  it('says where FluidNC keeps laser mode instead of offering a write', async () => {
    connectStockGrbl(0);
    useLaserStore.setState({
      capabilities: { ...originalCapabilities, settings: 'readonly-dump' },
    });
    const view = await renderWizard(undefined, mockPlatform(), { newMachine: true });
    try {
      const card = view.host.querySelector('.lf-setup-laser-mode-off');
      expect(card?.textContent).toContain('set the spindle to Laser in the FluidNC config file');
      expect(card?.textContent).not.toContain('Turn on laser mode ($32=1)');
    } finally {
      await view.unmount();
    }
  });
});

function resetTestState(): void {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    detectedSettings: null,
    controllerSettings: null,
    detectedControllerKind: null,
    activeControllerKind: 'grbl-v1.1',
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    connectedBaudRate: null,
    writeGrblSetting: originalWrite,
    capabilities: originalCapabilities,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  useToastStore.setState({ toasts: [] });
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
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
