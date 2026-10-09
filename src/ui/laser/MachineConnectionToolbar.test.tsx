import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { FALCON_A1_PRO_INFRARED_2W_MODULE } from '../../core/devices/laser-modules';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { DEVICE_SETUP_CONFIGURED_STORAGE_KEY } from '../state/device-setup-configured-persistence';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { LaserWindow } from './LaserWindow';
import { MachineConnectionToolbar } from './MachineConnectionToolbar';
import { MachineSetupDialogHost } from './device-setup';
import { closeMachineSetup } from './device-setup/machine-setup-dialog-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    motionOperation: null,
    controllerOperation: null,
    controllerQualification: { kind: 'disconnected', epoch: 0 },
    safetyNotice: null,
    detectedSettings: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  });
  useUiStore.getState().setRailPanelVisible('machine', true);
  dismissToasts();
  useStore.getState().replaceDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetStore();
  useUiStore.getState().setRailPanelVisible('machine', true);
  dismissToasts();
});

describe('machine toolbar', () => {
  it('restores focus to the machine trigger when first setup closes while Connect is disabled', async () => {
    const savedSetup = localStorage.getItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY);
    localStorage.removeItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY);
    let failOpen!: (error: Error) => void;
    const pendingOpen = new Promise<SerialConnection>((_resolve, reject) => {
      failOpen = reject;
    });
    const waitingPlatform: PlatformAdapter = {
      ...platform,
      serial: {
        isSupported: () => true,
        requestPort: async () => ({ open: () => pendingOpen }),
      },
    };
    try {
      await act(async () => {
        root.render(
          <PlatformProvider adapter={waitingPlatform}>
            <MachineConnectionToolbar />
            <MachineSetupDialogHost />
          </PlatformProvider>,
        );
      });
      const connect = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Connect',
      );
      const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]');
      if (connect === undefined || trigger === null) throw new Error('Connection controls missing');
      await act(async () => {
        connect.focus();
        connect.click();
      });
      expect(useLaserStore.getState().connection.kind).toBe('connecting');
      expect(connect.disabled).toBe(true);
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      expect(dialog?.contains(document.activeElement)).toBe(true);
      await act(async () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
      });
      expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      await act(async () => {
        failOpen(new Error('Selected port could not open'));
        await pendingOpen.catch(() => undefined);
      });
      expect(connect.disabled).toBe(false);
      expect(document.activeElement).toBe(trigger);
    } finally {
      await act(async () => {
        failOpen(new Error('Selected port could not open'));
        await pendingOpen.catch(() => undefined);
        closeMachineSetup();
      });
      if (savedSetup === null) localStorage.removeItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY);
      else localStorage.setItem(DEVICE_SETUP_CONFIGURED_STORAGE_KEY, savedSetup);
    }
  });

  it('opens Machine Setup from the compact top bar', async () => {
    await act(async () => {
      root.render(
        <PlatformProvider adapter={platform}>
          <>
            <MachineConnectionToolbar />
            <MachineSetupDialogHost />
          </>
        </PlatformProvider>,
      );
    });
    expect(host.textContent).not.toContain('Use Neotronics 4040 Max');
    const setup = host.querySelector<HTMLButtonElement>('button[aria-label="Machine Setup"]');
    expect(setup).toBeInstanceOf(HTMLButtonElement);
    if (setup === null) throw new Error('Machine Setup button missing');
    await act(async () => setup.click());
    expect(host.textContent).toContain('Step 1 of 3');
    expect(host.querySelectorAll('input[name="machine-capability"]')).toHaveLength(3);
  });

  it('keeps the fitted module in the project after closing and reopening machine details', async () => {
    await act(async () => {
      root.render(
        <PlatformProvider adapter={platform}>
          <MachineConnectionToolbar />
        </PlatformProvider>,
      );
    });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]');
    if (trigger === null) throw new Error('Machine details trigger missing');
    expect(host.querySelector('select[aria-label="Laser module"]')).toBeNull();
    await act(async () => trigger.click());
    const select = document.querySelector<HTMLSelectElement>(
      '[role="dialog"][aria-label="Machine details"] select[aria-label="Laser module"]',
    );
    if (select === null) throw new Error('Fitted module selector missing');
    expect(document.activeElement).toBe(select);
    expect([...select.options].map((option) => option.text)).toEqual([
      '20 W blue (455 nm)',
      '2 W infrared (1064 nm)',
    ]);
    await act(async () => {
      select.value = '1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useStore.getState().project.device.laserSubProfile).toEqual(
      FALCON_A1_PRO_INFRARED_2W_MODULE,
    );
    const close = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Close machine details"]',
    );
    await act(async () => close?.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await act(async () => trigger.click());
    expect(
      document.querySelector<HTMLSelectElement>('select[aria-label="Laser module"]')?.value,
    ).toBe('1');
  });

  it('notifies controller settings detection immediately while the machine rail is collapsed', async () => {
    useUiStore.getState().setRailPanelVisible('machine', false);
    await renderToolbarAndRail();
    expect(host.querySelector('aside[aria-label="Laser controls collapsed"]')).not.toBeNull();

    await act(async () => completeControllerSettingsRead(123));

    expect(settingsNotifications()).toHaveLength(1);
    expect(settingsNotifications()[0]).toMatchObject({
      variant: 'info',
      message: expect.stringMatching(/machine settings detected/i),
    });
    expect(settingsNotifications()[0]?.message).toContain('Machine Setup');
  });

  it('notifies each settings read once when the machine rail closes and reopens', async () => {
    await renderToolbarAndRail();
    await act(async () => completeControllerSettingsRead(123));
    expect(settingsNotifications()).toHaveLength(1);
    const notification = settingsNotifications()[0];

    const collapse = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse Laser panel"]',
    );
    if (collapse === null) throw new Error('Machine rail collapse button missing');
    await act(async () => collapse.click());
    const expand = host.querySelector<HTMLButtonElement>('button[aria-label="Expand Laser panel"]');
    if (expand === null) throw new Error('Machine rail expand button missing');
    await act(async () => expand.click());

    expect(settingsNotifications()).toEqual([notification]);
    await act(async () => completeControllerSettingsRead(124));
    expect(settingsNotifications()).toHaveLength(2);
  });
});

async function renderToolbarAndRail(): Promise<void> {
  await act(async () => {
    root.render(
      <PlatformProvider adapter={platform}>
        <>
          <MachineConnectionToolbar />
          <LaserWindow />
        </>
      </PlatformProvider>,
    );
  });
}

function completeControllerSettingsRead(readAt: number): void {
  useLaserStore.setState({
    detectedSettings: { maxPowerS: 255 },
    controllerSettings: { maxPowerS: 255 },
    grblSettingsRows: [],
    lastSettingsReadAt: readAt,
  });
}

function dismissToasts(): void {
  const { toasts, dismissToast } = useToastStore.getState();
  for (const toast of toasts) dismissToast(toast.id);
}

function settingsNotifications() {
  return useToastStore
    .getState()
    .toasts.filter((toast) => toast.message.startsWith('Machine settings detected:'));
}
