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

// A Marlin board that does not reboot on open (native USB): no `start`
// banner, but every M114 gets a position line and `ok`.
function bannerlessMarlin(): SerialConnection {
  const handlers = new Set<(line: string) => void>();
  return {
    write: async (data) => {
      if (data !== 'M114\n') return;
      setTimeout(() => {
        for (const handler of handlers) handler('X:0.00 Y:0.00 Z:0.00 E:0.00 Count X:0 Y:0 Z:0');
        for (const handler of handlers) handler('ok');
      }, 0);
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
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
  // Real timers first: a disconnect waits on its own timeouts.
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
});

describe('connection diagnostics', () => {
  it('reports the configured baud that was actually used when the controller stays silent', async () => {
    vi.useFakeTimers();
    await useLaserStore
      .getState()
      .connect(adapterFor(silentConnection()), { controllerKind: 'grbl-v1.1', baudRate: 57600 });

    await vi.advanceTimersByTimeAsync(2001);

    expect(useLaserStore.getState().log).toContain(
      '[lf2] No controller response within 2 s. Check baud rate (57600) and that the device is GRBL v1.1.',
    );
  });

  // Controller audit connect-5: Marlin has no realtime status query, so the
  // handshake sends nothing and its silence proves nothing. The first M114
  // poll decides; only a board that never answers it is reported.
  it('waits for the first status poll before calling a silent Marlin unresponsive', async () => {
    vi.useFakeTimers();
    await useLaserStore
      .getState()
      .connect(adapterFor(silentConnection()), { controllerKind: 'marlin', baudRate: 57600 });

    await vi.advanceTimersByTimeAsync(2001);
    expect(useLaserStore.getState().controllerQualification).toMatchObject({
      kind: 'qualifying',
      phase: 'controller-response',
    });
    expect(
      useLaserStore.getState().log.some((line) => line.includes('No controller response')),
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(8000);
    expect(useLaserStore.getState().log).toContain(
      '[lf2] No controller response within 8 s. Check baud rate (57600) and that the device is Marlin.',
    );
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
  });

  it('qualifies a Marlin board that answers M114 without a startup banner', async () => {
    vi.useFakeTimers();
    await useLaserStore
      .getState()
      .connect(adapterFor(bannerlessMarlin()), { controllerKind: 'marlin', baudRate: 250000 });

    await vi.advanceTimersByTimeAsync(10_000);

    const laser = useLaserStore.getState();
    expect(laser.log.some((line) => line.includes('No controller response'))).toBe(false);
    expect(laser.controllerQualification).toMatchObject({
      kind: 'qualified',
      settings: 'not-required',
    });
  });
});
