// ADR-639: a remote Connect never shows a port picker on the PC, but a person
// asked for it, so a failed open is reported, not skipped like the background
// auto-connect, and only a port that opened lifts the Disconnect pause.

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection, SerialPortIdentity } from '../../platform/types';
import {
  pauseAutoConnect,
  resetAutoConnectSession,
  useAutoConnectSession,
} from '../state/auto-connect-session';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { rememberSerialPort } from '../state/serial-port-memory';
import { executeConnect, executeDisconnect } from './machine-actions';
import type { MachineExecutionContext } from './machine-execution';
import type { OwnedMachineOperation } from './machine-operation-state';

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

function operation(): OwnedMachineOperation {
  return { state: 'queued', committed: null } as unknown as OwnedMachineOperation;
}

function from(platform: PlatformAdapter): MachineExecutionContext {
  return { options: { getPlatform: () => platform } } as unknown as MachineExecutionContext;
}

const paused = (): boolean => useAutoConnectSession.getState().paused;
const storeDisconnect = useLaserStore.getState().disconnect;

beforeEach(() => {
  localStorage.clear();
  rememberSerialPort(localStorage, CH340);
  resetAutoConnectSession();
  useLaserStore.setState(initialLaserState());
});

afterEach(async () => {
  useLaserStore.setState({ disconnect: storeDisconnect });
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  useLaserStore.setState(initialLaserState());
  resetAutoConnectSession();
  localStorage.clear();
});

it('tells the remote the port is busy instead of that no connection was saved', async () => {
  await expect(executeConnect(operation(), from(busyPort))).rejects.toThrow(
    'The machine’s port is busy or unavailable on the PC.',
  );
  // The PC shows it as a failed Connect, not the background skip.
  expect(useLaserStore.getState().connection).toEqual({ kind: 'failed', error: BUSY });
  expect(useAutoConnectSession.getState().skippedReason).toBeNull();
});

it('lifts the Disconnect pause only once its port opened', async () => {
  pauseAutoConnect();
  await expect(executeConnect(operation(), from(busyPort))).rejects.toThrow();
  expect(paused()).toBe(true);

  await executeConnect(operation(), from(openPort));
  expect(useLaserStore.getState().connection.kind).toBe('connected');
  expect(paused()).toBe(false);
});

it('pauses auto-connect when the remote disconnects', async () => {
  const disconnect = vi.fn(async () => undefined);
  useLaserStore.setState({ connection: { kind: 'connected' }, disconnect });
  await executeDisconnect(operation());
  expect(disconnect).toHaveBeenCalledOnce();
  expect(paused()).toBe(true);
});
