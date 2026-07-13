import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

function silentConnection(): SerialConnection {
  return {
    write: async () => undefined,
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => undefined,
  };
}

function adapterFor(connection: SerialConnection): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
}

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  vi.useRealTimers();
});

describe('connection diagnostics', () => {
  it('reports the configured baud that was actually used when the controller stays silent', async () => {
    vi.useFakeTimers();
    await useLaserStore
      .getState()
      .connect(adapterFor(silentConnection()), { controllerKind: 'marlin', baudRate: 57600 });

    await vi.advanceTimersByTimeAsync(2001);

    expect(useLaserStore.getState().log).toContain(
      '[lf2] No controller response within 2 s. Check baud rate (57600) and that the device is Marlin.',
    );
  });
});
