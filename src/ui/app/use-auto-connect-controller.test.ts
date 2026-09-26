import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialPortIdentity, SerialPortRef } from '../../platform/types';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { rememberSerialPort, saveAutoConnectPreference } from '../state/serial-port-memory';
import { installAutoConnect } from './use-auto-connect-controller';

const CH340: SerialPortIdentity = { usbVendorId: 0x1a86, usbProductId: 0x7523 };

function port(info: SerialPortIdentity): SerialPortRef {
  return {
    info,
    open: async () => {
      throw new Error('the store connect is mocked in this test');
    },
  };
}

function platformWith(granted: () => ReadonlyArray<SerialPortRef>) {
  const listeners = new Set<() => void>();
  const requestPort = vi.fn(async () => null);
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort,
      grantedPorts: async () => granted(),
      onGrantedPortsChange: (handler) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
    },
  };
  const plugIn = (): void => {
    for (const listener of listeners) listener();
  };
  return { platform, plugIn, requestPort, listeners };
}

const connect = vi.fn(async () => undefined);

beforeEach(() => {
  localStorage.clear();
  useLaserStore.setState({ ...initialLaserState(), connect });
  connect.mockClear();
});

afterEach(() => {
  localStorage.clear();
  useLaserStore.setState(initialLaserState());
});

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe('auto-connect', () => {
  it('connects to the remembered port at start, without a picker', async () => {
    rememberSerialPort(localStorage, CH340);
    const { platform, requestPort } = platformWith(() => [port(CH340)]);

    const dispose = installAutoConnect(platform);
    await settle();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(
      platform,
      expect.objectContaining({ portSelection: 'automatic' }),
    );
    expect(requestPort).not.toHaveBeenCalled();
    dispose();
  });

  it('connects when the machine is plugged in later', async () => {
    rememberSerialPort(localStorage, CH340);
    let attached: ReadonlyArray<SerialPortRef> = [];
    const { platform, plugIn } = platformWith(() => attached);

    const dispose = installAutoConnect(platform);
    await settle();
    expect(connect).not.toHaveBeenCalled();

    attached = [port(CH340)];
    plugIn();
    await settle();
    expect(connect).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('stays quiet when turned off, when connected, or when the port would need asking', async () => {
    rememberSerialPort(localStorage, CH340);
    const twoIdentical = platformWith(() => [port(CH340), port(CH340)]);
    installAutoConnect(twoIdentical.platform)();
    await settle();

    saveAutoConnectPreference(localStorage, false);
    const off = platformWith(() => [port(CH340)]);
    const disposeOff = installAutoConnect(off.platform);
    await settle();

    saveAutoConnectPreference(localStorage, true);
    useLaserStore.setState({ connection: { kind: 'connected' } });
    const connected = platformWith(() => [port(CH340)]);
    const disposeConnected = installAutoConnect(connected.platform);
    await settle();

    expect(connect).not.toHaveBeenCalled();
    disposeOff();
    disposeConnected();
  });

  it('stops listening for plug-ins once disposed', async () => {
    const { platform, listeners } = platformWith(() => []);
    const dispose = installAutoConnect(platform);
    expect(listeners.size).toBe(1);
    dispose();
    expect(listeners.size).toBe(0);
  });
});
