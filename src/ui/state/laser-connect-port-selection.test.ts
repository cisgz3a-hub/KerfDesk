// Connect reuses the port the operator picked before (ADR-420): no picker for
// the remembered adapter, the picker on request, and never a picker for an
// automatic connect, which has no click to show one with.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PlatformAdapter,
  SerialConnection,
  SerialPortIdentity,
  SerialPortRef,
} from '../../platform/types';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { loadRememberedSerialPort, rememberSerialPort } from './serial-port-memory';

const CH340: SerialPortIdentity = { usbVendorId: 0x1a86, usbProductId: 0x7523 };
const CP2102: SerialPortIdentity = { usbVendorId: 0x10c4, usbProductId: 0xea60 };

function connectionStub(): SerialConnection {
  return {
    write: async () => undefined,
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => undefined,
  };
}

function portStub(info: SerialPortIdentity, opened: SerialPortIdentity[]): SerialPortRef {
  return {
    info,
    open: async () => {
      opened.push(info);
      return connectionStub();
    },
    forget: async () => undefined,
  };
}

function adapter(args: {
  readonly granted: ReadonlyArray<SerialPortRef>;
  readonly picked?: SerialPortRef | null;
}) {
  const requestPort = vi.fn(async () => args.picked ?? null);
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort,
      grantedPorts: async () => args.granted,
    },
  };
  return { platform, requestPort };
}

beforeEach(() => {
  localStorage.clear();
  useLaserStore.setState(initialLaserState());
});

afterEach(async () => {
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  useLaserStore.setState(initialLaserState());
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('connect port selection', () => {
  it('opens the remembered adapter without the picker', async () => {
    rememberSerialPort(localStorage, CH340);
    const opened: SerialPortIdentity[] = [];
    const { platform, requestPort } = adapter({
      granted: [portStub(CP2102, opened), portStub(CH340, opened)],
    });

    await useLaserStore.getState().connect(platform);

    expect(requestPort).not.toHaveBeenCalled();
    expect(opened).toEqual([CH340]);
    expect(useLaserStore.getState().connection.kind).toBe('connected');
    expect(useLaserStore.getState().serialPortInfo).toEqual(CH340);
  });

  it('shows the picker for a different port, and remembers the one picked', async () => {
    rememberSerialPort(localStorage, CH340);
    const opened: SerialPortIdentity[] = [];
    const picked = portStub(CP2102, opened);
    const { platform, requestPort } = adapter({ granted: [portStub(CH340, opened)], picked });

    await useLaserStore.getState().connect(platform, { portSelection: 'choose', baudRate: 250000 });

    expect(requestPort).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([CP2102]);
    expect(loadRememberedSerialPort(localStorage)).toEqual(CP2102);
    expect(useLaserStore.getState().connectedBaudRate).toBe(250000);
  });

  it('asks when two identical adapters were both picked before', async () => {
    rememberSerialPort(localStorage, CH340);
    const opened: SerialPortIdentity[] = [];
    const { platform, requestPort } = adapter({
      granted: [portStub(CH340, opened), portStub(CH340, opened)],
      picked: null,
    });

    await useLaserStore.getState().connect(platform);

    expect(requestPort).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([]);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
  });

  it('never shows the picker for an automatic connect', async () => {
    const { platform, requestPort } = adapter({ granted: [] });

    await useLaserStore.getState().connect(platform, { portSelection: 'automatic' });

    expect(requestPort).not.toHaveBeenCalled();
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
  });

  it('forgets the remembered port with Forget Controller', async () => {
    rememberSerialPort(localStorage, CH340);
    const { platform } = adapter({ granted: [portStub(CH340, [])] });
    await useLaserStore.getState().connect(platform);

    await useLaserStore.getState().forgetDevice?.();

    expect(loadRememberedSerialPort(localStorage)).toBeNull();
    expect(useLaserStore.getState().connectedBaudRate).toBeNull();
  });
});
