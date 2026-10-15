import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControllerKind } from '../../core/devices';
import type { PlatformAdapter, SerialConnection, SerialPortRef } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function adapterFor(serial: PlatformAdapter['serial']): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial,
  };
}

function connection(): SerialConnection {
  return {
    write: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
    onLine: vi.fn(() => () => undefined),
    onClose: vi.fn(() => () => undefined),
  };
}

beforeEach(() => {
  useLaserStore.setState(initialLaserState());
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
});

const LIVE_CONTROLLERS: readonly ControllerKind[] = [
  'grbl-v1.1',
  'grblhal',
  'fluidnc',
  'marlin',
  'smoothieware',
];

describe('Disconnect cancels an unfinished connection', () => {
  it.each(LIVE_CONTROLLERS)(
    'returns %s to disconnected immediately while its picker is pending',
    async (controllerKind) => {
      const picker = deferred<SerialPortRef | null>();
      const lateConnection = connection();
      const open = vi.fn(async () => lateConnection);
      const forget = vi.fn(async () => undefined);
      const requestPort = vi.fn(() => picker.promise);
      const connecting = useLaserStore
        .getState()
        .connect(adapterFor({ isSupported: () => true, requestPort }), { controllerKind });
      await vi.waitFor(() => expect(requestPort).toHaveBeenCalledOnce());

      await useLaserStore.getState().disconnect();
      expect(useLaserStore.getState().connection.kind).toBe('disconnected');
      expect(useLaserStore.getState().controllerQualification.kind).toBe('disconnected');

      picker.resolve({ open, forget });
      await connecting;
      expect(open).not.toHaveBeenCalled();
      expect(forget).not.toHaveBeenCalled();
      expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    },
  );

  it.each(LIVE_CONTROLLERS)(
    'closes a late %s open without attaching it or forgetting permission',
    async (controllerKind) => {
      const opening = deferred<SerialConnection>();
      const lateConnection = connection();
      const open = vi.fn(() => opening.promise);
      const connecting = useLaserStore
        .getState()
        .connect(adapterFor({ isSupported: () => true, requestPort: async () => ({ open }) }), {
          controllerKind,
        });
      await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());

      await useLaserStore.getState().disconnect();
      expect(useLaserStore.getState().connection.kind).toBe('disconnected');

      opening.resolve(lateConnection);
      await connecting;
      expect(lateConnection.close).toHaveBeenCalledOnce();
      expect(lateConnection.forget).not.toHaveBeenCalled();
      expect(lateConnection.onLine).not.toHaveBeenCalled();
      expect(lateConnection.write).not.toHaveBeenCalled();
      expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    },
  );

  it('does not show a late picker after Disconnect cancels permission discovery', async () => {
    const grants = deferred<ReadonlyArray<SerialPortRef>>();
    const grantedPorts = vi.fn(() => grants.promise);
    const requestPort = vi.fn(async () => null);
    const connecting = useLaserStore
      .getState()
      .connect(adapterFor({ isSupported: () => true, grantedPorts, requestPort }));
    await vi.waitFor(() => expect(grantedPorts).toHaveBeenCalledOnce());

    await useLaserStore.getState().disconnect();
    grants.resolve([]);
    await connecting;

    expect(requestPort).not.toHaveBeenCalled();
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
  });

  it('leaves a newer attempt in charge when the cancelled open finishes', async () => {
    const opening = deferred<SerialConnection>();
    const lateConnection = connection();
    const open = vi.fn(() => opening.promise);
    const first = useLaserStore
      .getState()
      .connect(adapterFor({ isSupported: () => true, requestPort: async () => ({ open }) }));
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    await useLaserStore.getState().disconnect();

    const nextPicker = deferred<SerialPortRef | null>();
    const nextRequest = vi.fn(() => nextPicker.promise);
    const next = useLaserStore
      .getState()
      .connect(adapterFor({ isSupported: () => true, requestPort: nextRequest }));
    await vi.waitFor(() => expect(nextRequest).toHaveBeenCalledOnce());
    const newerState = useLaserStore.getState();

    opening.resolve(lateConnection);
    await first;
    expect(lateConnection.close).toHaveBeenCalledOnce();
    expect(useLaserStore.getState()).toBe(newerState);

    nextPicker.resolve(null);
    await next;
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
  });
});
