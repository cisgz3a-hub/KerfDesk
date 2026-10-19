// A failed open reads differently by who asked (ADR-633): the operator's
// Connect keeps the red "Couldn't connect" and its incident; a background
// auto-connect ends disconnected with one log line and a quiet hint.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter, SerialConnection, SerialPortIdentity } from '../../platform/types';
import { resetAutoConnectSession, useAutoConnectSession } from './auto-connect-session';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { rememberSerialPort } from './serial-port-memory';

const CH340: SerialPortIdentity = { usbVendorId: 0x1a86, usbProductId: 0x7523 };
const BUSY = 'Failed to execute open on SerialPort: Failed to open serial port.';

function adapter(open: () => Promise<SerialConnection>): PlatformAdapter {
  const port = { info: CH340, open, forget: async () => undefined };
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => port,
      grantedPorts: async () => [port],
    },
  };
}

const busyPort = adapter(async () => {
  throw new Error(BUSY);
});

const openPort = adapter(async () => ({
  write: async () => undefined,
  onLine: () => () => undefined,
  onClose: () => () => undefined,
  close: async () => undefined,
}));

beforeEach(() => {
  localStorage.clear();
  rememberSerialPort(localStorage, CH340);
  resetAutoConnectSession();
  useLaserStore.setState(initialLaserState());
});

afterEach(async () => {
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  useLaserStore.setState(initialLaserState());
  resetAutoConnectSession();
  localStorage.clear();
});

describe('a failed connect', () => {
  it('stays quiet when nobody clicked', async () => {
    await useLaserStore.getState().connect(busyPort, { portSelection: 'automatic' });

    const laser = useLaserStore.getState();
    expect(laser.connection).toEqual({ kind: 'disconnected' });
    expect(laser.incidentHistory ?? []).toEqual([]);
    expect(laser.log).toEqual([`[lf2] Automatic connect skipped: ${BUSY}`]);
    expect(useAutoConnectSession.getState().skippedReason).toBe(BUSY);
  });

  it.each(['remembered', 'choose'] as const)(
    'keeps the alert and the incident for a clicked %s Connect',
    async (portSelection) => {
      await useLaserStore.getState().connect(busyPort, { portSelection });

      const laser = useLaserStore.getState();
      expect(laser.connection).toEqual({ kind: 'failed', error: BUSY });
      expect(laser.incidentHistory?.length ?? 0).toBeGreaterThan(0);
      expect(laser.log.some((line) => line.includes('Controller connection failed'))).toBe(true);
      expect(useAutoConnectSession.getState().skippedReason).toBeNull();
    },
  );

  it('clears the skipped hint on the next attempt', async () => {
    await useLaserStore.getState().connect(busyPort, { portSelection: 'automatic' });
    expect(useAutoConnectSession.getState().skippedReason).toBe(BUSY);

    await useLaserStore.getState().connect(openPort, { portSelection: 'automatic' });

    expect(useLaserStore.getState().connection.kind).toBe('connected');
    expect(useAutoConnectSession.getState().skippedReason).toBeNull();
  });
});
