import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';
import { connectedControllerStatePatch } from './laser-connection-actions';
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
    detectedSettings: null,
    detectedControllerKind: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
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
    useLaserStore.setState({
      detectedSettings: { bedWidth: 999, maxPowerS: 24000 },
      detectedControllerKind: 'grblhal',
      controllerSettings: { bedWidth: 999, maxPowerS: 24000 },
      grblSettingsRows: settingsMapToRows(new Map([[30, '24000']])),
      lastSettingsReadAt: 1,
    });
    const adapter = adapterWithRequestPort(async () => null);

    await useLaserStore.getState().connect(adapter);

    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'disconnected' },
      detectedSettings: null,
      detectedControllerKind: null,
      controllerSettings: null,
      grblSettingsRows: [],
      lastSettingsReadAt: null,
    });
  });

  it('preserves an unacknowledged safety incident across reconnect', () => {
    const safetyNotice = {
      kind: 'disconnect-during-job' as const,
      message: 'USB connection was lost during an active job.',
    };

    const patch = connectedControllerStatePatch({
      ...useLaserStore.getState(),
      safetyNotice,
    });

    expect(patch.safetyNotice).toBe(safetyNotice);
  });
});
