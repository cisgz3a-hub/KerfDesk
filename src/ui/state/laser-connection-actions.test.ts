import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { useLaserStore } from './laser-store';

function adapterWithRequestPort(
  requestPort: PlatformAdapter['serial']['requestPort'],
): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort,
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    lastWriteError: null,
    safetyNotice: null,
    log: [],
    transcript: [],
  });
  vi.restoreAllMocks();
});

describe('connect port-picker failures', () => {
  // Firefox/Safari (no Web Serial) throw a TypeError from requestPort; on
  // Chromium a SecurityError/InvalidStateError can throw too. Awaited outside
  // any try, that left the store at { kind: 'connecting' } forever — both
  // Connect buttons disabled for the rest of the session — plus an unhandled
  // rejection.
  it('lands in the failed state (not stuck connecting) when the picker throws', async () => {
    const adapter = adapterWithRequestPort(async () => {
      throw new TypeError('navigator.serial is undefined');
    });

    await useLaserStore.getState().connect(adapter);

    expect(useLaserStore.getState().connection).toEqual({
      kind: 'failed',
      error: 'navigator.serial is undefined',
    });
  });

  it('returns to disconnected when the picker is cancelled', async () => {
    const adapter = adapterWithRequestPort(async () => null);

    await useLaserStore.getState().connect(adapter);

    expect(useLaserStore.getState().connection).toEqual({ kind: 'disconnected' });
  });
});
