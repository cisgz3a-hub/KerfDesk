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
  it.each(['remembered', 'automatic'] as const)(
    'does not replace a TCP session with a %s USB port',
    async (portSelection) => {
      const opened: SerialPortIdentity[] = [];
      const usb = adapter({ granted: [portStub(CH340, opened)] });
      const close = vi.fn(async () => undefined);
      const tcp: PlatformAdapter = {
        ...usb.platform,
        serial: {
          transport: 'tcp',
          isSupported: () => true,
          requestPort: async () => ({
            info: { transport: 'tcp' },
            open: async () => ({ ...connectionStub(), close }),
          }),
        },
      };
      await useLaserStore
        .getState()
        .connect(tcp, { controllerKind: 'grblhal', portSelection: 'choose' });
      const attempt = useLaserStore.getState().connectionAttempt;
      await useLaserStore.getState().connect(usb.platform, { portSelection });
      expect(opened).toEqual([]);
      expect(usb.requestPort).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      expect(useLaserStore.getState().connectionAttempt).toBe(attempt);
      await useLaserStore.getState().disconnect();
      expect(useLaserStore.getState().lastConnectionTransport).toBe('tcp');
      await useLaserStore.getState().connect(usb.platform, { portSelection });
      expect(opened).toEqual([]);
      expect(usb.requestPort).not.toHaveBeenCalled();
    },
  );

  it('keeps a failed network choice until an explicit USB selection succeeds', async () => {
    const opened: SerialPortIdentity[] = [];
    const usb = adapter({ granted: [portStub(CH340, opened)], picked: portStub(CH340, opened) });
    const tcp: PlatformAdapter = {
      ...usb.platform,
      serial: {
        transport: 'tcp',
        isSupported: () => true,
        requestPort: async () => {
          throw new Error('Network unreachable');
        },
      },
    };
    await useLaserStore
      .getState()
      .connect(tcp, { controllerKind: 'grblhal', portSelection: 'choose' });
    expect(useLaserStore.getState().connection.kind).toBe('failed');
    await useLaserStore.getState().connect(usb.platform);
    expect(opened).toEqual([]);
    const cancelled = adapter({ granted: [], picked: null });
    await useLaserStore.getState().connect(cancelled.platform, { portSelection: 'choose' });
    expect(useLaserStore.getState().lastConnectionTransport).toBe('tcp');
    await useLaserStore.getState().connect(usb.platform, { portSelection: 'choose' });
    expect(opened).toEqual([CH340]);
    expect(usb.requestPort).toHaveBeenCalledOnce();
    expect(useLaserStore.getState().lastConnectionTransport).toBe('serial');
  });

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
