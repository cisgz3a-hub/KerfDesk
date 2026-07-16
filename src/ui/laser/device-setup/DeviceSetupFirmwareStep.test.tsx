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

async function renderStep(
  state: ReturnType<typeof initDeviceSetup>,
): Promise<{ readonly host: HTMLDivElement; readonly unmount: () => Promise<void> }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={adapter}>
        <DeviceSetupFirmwareStep state={state} dispatch={vi.fn()} />
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
