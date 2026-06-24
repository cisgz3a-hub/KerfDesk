import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { FileOpenRequest, FileSaveRequest, PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { DeviceSetupWizard } from './DeviceSetupWizard';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const FALCON_ID = 'creality-falcon-a1-pro-compatible';
const IDLE_STATUS = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: null,
  feed: 0,
  spindle: 0,
} as const;

function mockPlatform(): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: vi.fn(async (_request: FileOpenRequest) => []),
    pickFileForSave: vi.fn(async (_request: FileSaveRequest) => ({
      displayName: 'mock.json',
      write: vi.fn(async () => undefined),
    })),
    serial: { isSupported: () => true, requestPort: async () => null },
  };
}

async function renderWizard(onClose: () => void = () => undefined): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform()}>
        <DeviceSetupWizard onClose={onClose} />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    detectedSettings: null,
    statusReport: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('DeviceSetupWizard', () => {
  it('opens on the connect step', async () => {
    const { host, unmount } = await renderWizard();
    try {
      expect(host.textContent).toContain('Step 1 of 6');
      expect(host.textContent).toContain('Connect & read');
    } finally {
      await unmount();
    }
  });

  it('exposes help metadata on the wizard navigation buttons', async () => {
    const { host, unmount } = await renderWizard();
    try {
      const nav: ReadonlyArray<readonly [string, string]> = [
        ['Cancel', 'control:laser.device-setup.cancel'],
        ['Back', 'control:laser.device-setup.back'],
        ['Next', 'control:laser.device-setup.next'],
      ];
      for (const [label, helpId] of nav) {
        const target = button(host, label);
        expect(target.dataset.helpId).toBe(helpId);
        expect(target.title.length).toBeGreaterThan(30);
      }
      await advanceUntil(host, 'Finish setup');
      const finish = button(host, 'Finish setup');
      expect(finish.dataset.helpId).toBe('control:laser.device-setup.finish');
      expect(finish.title.length).toBeGreaterThan(30);
    } finally {
      await unmount();
    }
  });

  it('applies a preset to the draft and commits only on Finish', async () => {
    const { host, unmount } = await renderWizard();
    try {
      await act(async () => button(host, 'Next').click()); // connect -> identify
      await act(async () => button(host, 'Use Creality Falcon A1 Pro').click());
      // The preset edits the draft; the live profile is untouched until Finish.
      expect(useStore.getState().project.device.profileId).toBe(DEFAULT_DEVICE_PROFILE.profileId);

      await advanceUntil(host, 'Finish setup');
      const finish = button(host, 'Finish setup');
      expect(finish.disabled).toBe(false);
      await act(async () => finish.click());

      expect(useStore.getState().project.device.profileId).toBe(FALCON_ID);
    } finally {
      await unmount();
    }
  });

  it('keeps Finish disabled on the untouched generic default', async () => {
    const { host, unmount } = await renderWizard();
    try {
      await advanceUntil(host, 'Finish setup');
      expect(button(host, 'Finish setup').disabled).toBe(true);
      expect(useStore.getState().project.device.profileId).toBe(DEFAULT_DEVICE_PROFILE.profileId);
    } finally {
      await unmount();
    }
  });

  it('discards the draft and does not commit when cancelled', async () => {
    const onClose = vi.fn();
    const { host, unmount } = await renderWizard(onClose);
    try {
      await act(async () => button(host, 'Next').click()); // connect -> identify
      await act(async () => button(host, 'Use Creality Falcon A1 Pro').click());
      await act(async () => button(host, 'Cancel').click());
      expect(onClose).toHaveBeenCalled();
      expect(useStore.getState().project.device.profileId).toBe(DEFAULT_DEVICE_PROFILE.profileId);
    } finally {
      await unmount();
    }
  });

  it('commits edits made through the reused field editors', async () => {
    const { host, unmount } = await renderWizard();
    try {
      await act(async () => button(host, 'Next').click()); // connect -> identify
      await act(async () => button(host, 'Use Creality Falcon A1 Pro').click());
      await act(async () => button(host, 'Next').click()); // identify -> confirm
      const bed = host.querySelector('input[aria-label="Bed width (mm)"]');
      if (!(bed instanceof HTMLInputElement)) throw new Error('bed width input missing');
      await act(async () => {
        bed.value = '555';
        Simulate.change(bed);
      });
      await advanceUntil(host, 'Finish setup');
      await act(async () => button(host, 'Finish setup').click());
      expect(useStore.getState().project.device.bedWidth).toBe(555);
      expect(useStore.getState().project.device.profileId).toBe(FALCON_ID);
    } finally {
      await unmount();
    }
  });

  it('commits Safety-step edits (machine name) through the wizard draft', async () => {
    const { host, unmount } = await renderWizard();
    try {
      await act(async () => button(host, 'Next').click()); // connect -> identify
      await act(async () => button(host, 'Use Creality Falcon A1 Pro').click());
      await advanceUntil(host, 'Homing'); // reach the safety step
      const name = host.querySelector('input[aria-label="Device name"]');
      if (!(name instanceof HTMLInputElement)) throw new Error('name input missing on safety step');
      await act(async () => {
        name.value = 'Shopfloor Falcon';
        Simulate.change(name);
      });
      await advanceUntil(host, 'Finish setup');
      await act(async () => button(host, 'Finish setup').click());
      expect(useStore.getState().project.device.name).toBe('Shopfloor Falcon');
    } finally {
      await unmount();
    }
  });

  it('offers a guarded firmware write when the controller differs from the draft', async () => {
    const originalWrite = useLaserStore.getState().writeGrblSetting;
    const writeGrblSetting = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: IDLE_STATUS,
      grblSettingsRows: settingsMapToRows(new Map<number, string>([[30, '255']])),
      lastSettingsReadAt: 1718600000000,
      writeGrblSetting,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderWizard();
    try {
      await advanceUntil(host, 'Sync to controller');
      const confirm = host.querySelector('input[aria-label="Confirm write $30"]');
      if (!(confirm instanceof HTMLInputElement)) throw new Error('confirm checkbox missing');
      const write = button(host, 'Write $30');
      expect(write.disabled).toBe(true); // disabled until confirmed

      await act(async () => {
        confirm.checked = true;
        Simulate.change(confirm);
      });
      expect(write.disabled).toBe(false);

      await act(async () => {
        write.click();
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      // The draft's $30 (1000) is written, not the controller's current 255.
      expect(writeGrblSetting).toHaveBeenCalledWith(30, '1000');
    } finally {
      await unmount();
      await act(async () => {
        useLaserStore.setState({ writeGrblSetting: originalWrite });
      });
    }
  });

  it('never offers a firmware write for machine-critical settings (bed travel)', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: IDLE_STATUS,
      grblSettingsRows: settingsMapToRows(new Map<number, string>([[130, '500']])),
      lastSettingsReadAt: 1718600000000,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderWizard();
    try {
      await advanceUntil(host, 'Sync to controller');
      // $130 (machine-critical) is surfaced read-only — never with a Write button.
      expect(host.textContent).toContain('$130');
      const writeButtons = [...host.querySelectorAll('button')].filter((candidate) =>
        candidate.textContent?.includes('Write'),
      );
      expect(writeButtons).toEqual([]);
    } finally {
      await unmount();
    }
  });
});

async function advanceUntil(host: HTMLElement, text: string): Promise<void> {
  for (let guard = 0; guard < 8; guard += 1) {
    if (host.textContent?.includes(text) === true) return;
    await act(async () => button(host, 'Next').click());
  }
  throw new Error(`did not reach: ${text}`);
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
