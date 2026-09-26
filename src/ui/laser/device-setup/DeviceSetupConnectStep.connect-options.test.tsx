// Machine Setup's Find my machine and Reconnect must pass the draft's Background
// streaming choice the way the rail and menu Connect do. They sent it only for
// an explicit opt-in, and connect() treats a missing choice as on for
// GRBL-family drivers, so an operator who unticked the setting and clicked
// Reconnect still got the worker transport (2026-09-25 audit, SER-2).

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { DeviceSetupConnectStep } from './DeviceSetupConnectStep';
import { initDeviceSetup } from './device-setup-flow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ConnectFn = ReturnType<typeof useLaserStore.getState>['connect'];
type SetupConnectButton = 'Find my machine' | 'Reconnect using selected profile';

const original = useLaserStore.getState();

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

beforeEach(() => {
  useLaserStore.setState(initialLaserState());
});

afterEach(() => {
  useLaserStore.setState(original, true);
});

async function connectOptionsFrom(
  label: SetupConnectButton,
  workerHostedStreaming: boolean | undefined,
): Promise<unknown> {
  const connect = vi.fn<ConnectFn>(async () => undefined);
  useLaserStore.setState({
    connect,
    disconnect: vi.fn(async () => undefined),
    // Reconnect is offered while the live driver differs from the draft's.
    ...(label === 'Reconnect using selected profile'
      ? { connection: { kind: 'connected' as const }, activeControllerKind: 'grbl-v1.1' as const }
      : {}),
  });
  const state = initDeviceSetup(
    {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'grblhal',
      ...(workerHostedStreaming === undefined ? {} : { workerHostedStreaming }),
    },
    null,
  );
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <PlatformProvider adapter={platform}>
          <DeviceSetupConnectStep state={state} dispatch={vi.fn()} />
        </PlatformProvider>,
      );
    });
    const button = [...host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (button === undefined) throw new Error(`Missing button: ${label}`);
    await act(async () => {
      button.click();
    });
    expect(connect).toHaveBeenCalledTimes(1);
    return connect.mock.calls[0]?.[1];
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

describe.each(['Find my machine', 'Reconnect using selected profile'] as const)(
  'Machine Setup %s options',
  (label) => {
    it('carries a Background streaming opt-out so the worker stays off', async () => {
      expect(await connectOptionsFrom(label, false)).toEqual({
        controllerKind: 'grblhal',
        baudRate: 115_200,
        hostedStreaming: false,
      });
    });

    it('keeps an explicit opt-in', async () => {
      expect(await connectOptionsFrom(label, true)).toEqual({
        controllerKind: 'grblhal',
        baudRate: 115_200,
        hostedStreaming: true,
      });
    });

    it('leaves an unset choice to the connect default', async () => {
      const options = await connectOptionsFrom(label, undefined);
      expect(options).toEqual({ controllerKind: 'grblhal', baudRate: 115_200 });
      expect(options).not.toHaveProperty('hostedStreaming');
    });
  },
);
