import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../../core/scene';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { DeviceSetupFirmwareStep } from './DeviceSetupFirmwareStep';
import { initDeviceSetup } from './device-setup-flow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const adapter: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

afterEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    activeControllerKind: 'grbl-v1.1',
    statusReport: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('DeviceSetupFirmwareStep capability labels', () => {
  it('uses CNC-only labels and never offers laser $31 synchronization', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: 'grbl-v1.1',
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      grblSettingsRows: settingsMapToRows(
        new Map([
          [30, '1000'],
          [31, '0'],
          [32, '1'],
        ]),
      ),
      lastSettingsReadAt: Date.now(),
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const state = initDeviceSetup(
      {
        ...DEFAULT_DEVICE_PROFILE,
        capabilities: ['grbl', 'cnc-output'],
        cncSubProfile: DEFAULT_CNC_MACHINE_CONFIG.params,
      },
      null,
      { machine: DEFAULT_CNC_MACHINE_CONFIG },
    );
    const view = await renderStep(state);
    try {
      expect(view.host.textContent).toContain('CNC spindle output');
      expect(view.host.textContent).toContain('Maximum spindle speed');
      expect(view.host.textContent).toContain('Spindle output mode');
      expect(view.host.textContent).not.toContain('Laser S maximum');
      expect(view.host.textContent).not.toContain('Queue $31 for Save');
      expect(view.host.textContent).toContain('Queue $30 for Save');
      expect(view.host.textContent).toContain('Queue $32 for Save');
    } finally {
      await view.unmount();
    }
  });
});

describe('DeviceSetupFirmwareStep comparison evidence', () => {
  it.each([
    ['empty readback', {}],
    ['invalid supported value', { 30: 'corrupt' }],
    ['unknown setting only', { 999: 'vendor-only' }],
  ] as const)('does not claim a match for %s', async (_name, values) => {
    setConnectedReadback(values);
    const view = await renderStep(initDeviceSetup(DEFAULT_DEVICE_PROFILE, null));
    try {
      expect(view.host.textContent).not.toContain(
        'The compared controller values match this software profile.',
      );
      expect(view.host.textContent).toContain('Compared 0 of 5 profile settings.');
      expect(view.host.textContent).toContain('Firmware agreement could not be verified');
      expect(view.host.textContent).not.toContain('Queue $30 for Save');
    } finally {
      await view.unmount();
    }
  });

  it('shows a complete match only when every expected value is numeric and matches', async () => {
    setConnectedReadback(matchingLaserReadback());
    const view = await renderStep(initDeviceSetup(DEFAULT_DEVICE_PROFILE, null));
    try {
      expect(view.host.textContent).toContain('Compared 5 of 5 profile settings.');
      expect(view.host.textContent).toContain(
        'The compared controller values match this software profile.',
      );
      expect(view.host.textContent).not.toContain('Not reported:');
      expect(view.host.textContent).not.toContain('Invalid readback:');
    } finally {
      await view.unmount();
    }
  });

  it('qualifies a partial numeric match and names the unread settings', async () => {
    setConnectedReadback({ 30: String(DEFAULT_DEVICE_PROFILE.maxPowerS) });
    const view = await renderStep(initDeviceSetup(DEFAULT_DEVICE_PROFILE, null));
    try {
      expect(view.host.textContent).toContain('Compared 1 of 5 profile settings.');
      expect(view.host.textContent).toContain('Not reported: $31, $32, $130, $131.');
      expect(view.host.textContent).toContain(
        'Reported numeric values match where compared. Firmware comparison is incomplete.',
      );
      expect(view.host.textContent).not.toContain(
        'The compared controller values match this software profile.',
      );
    } finally {
      await view.unmount();
    }
  });

  it('keeps one corrupt value unverified even when all other values match', async () => {
    setConnectedReadback({ ...matchingLaserReadback(), 30: 'corrupt' });
    const view = await renderStep(initDeviceSetup(DEFAULT_DEVICE_PROFILE, null));
    try {
      expect(view.host.textContent).toContain('Compared 4 of 5 profile settings.');
      expect(view.host.textContent).toContain('Invalid readback: $30.');
      expect(view.host.textContent).toContain('Firmware comparison is incomplete.');
      expect(view.host.textContent).not.toContain(
        'The compared controller values match this software profile.',
      );
      expect(view.host.textContent).not.toContain('Queue $30 for Save');
    } finally {
      await view.unmount();
    }
  });

  it('still queues a confirmed numeric mismatch while keeping travel review-only', async () => {
    setConnectedReadback({ ...matchingLaserReadback(), 30: '255', 130: '390' });
    const dispatch = vi.fn();
    const view = await renderStep(
      {
        ...initDeviceSetup(DEFAULT_DEVICE_PROFILE, null),
        firmwareBackupConfirmed: true,
      },
      dispatch,
    );
    try {
      expect(view.host.textContent).toContain('Compared 5 of 5 profile settings.');
      expect(view.host.textContent).not.toContain(
        'The compared controller values match this software profile.',
      );
      expect(view.host.textContent).toContain('Review only');
      expect(view.host.textContent).not.toContain('Queue $130 for Save');
      const queue = Array.from(view.host.querySelectorAll('button')).find(
        (button) => button.textContent === 'Queue $30 for Save',
      );
      expect(queue?.disabled).toBe(true);
      const confirm = view.host.querySelector<HTMLInputElement>('[aria-label="Confirm write $30"]');
      expect(confirm).not.toBeNull();
      await act(async () => confirm?.click());
      expect(queue?.disabled).toBe(false);
      await act(async () => queue?.click());
      expect(dispatch).toHaveBeenLastCalledWith({ kind: 'toggle-firmware-write', id: 30 });
    } finally {
      await view.unmount();
    }
  });
});

function matchingLaserReadback(): Readonly<Record<number, string>> {
  const draft = DEFAULT_DEVICE_PROFILE;
  return {
    30: String(draft.maxPowerS),
    31: String(draft.minPowerS),
    32: draft.laserModeEnabled ? '1' : '0',
    130: String(draft.bedWidth),
    131: String(draft.bedHeight),
  };
}

function setConnectedReadback(values: Readonly<Record<number, string>>): void {
  useLaserStore.setState({
    connection: { kind: 'connected' },
    activeControllerKind: 'grbl-v1.1',
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
    grblSettingsRows: settingsMapToRows(
      new Map(Object.entries(values).map(([id, value]) => [Number(id), value])),
    ),
    lastSettingsReadAt: Date.now(),
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
}

async function renderStep(
  state: ReturnType<typeof initDeviceSetup>,
  dispatch = vi.fn(),
): Promise<{ readonly host: HTMLDivElement; readonly unmount: () => Promise<void> }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={adapter}>
        <DeviceSetupFirmwareStep state={state} dispatch={dispatch} />
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
