import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';
import {
  pauseAutoConnect,
  resetAutoConnectSession,
  useAutoConnectSession,
} from './auto-connect-session';
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
      rxCapacityEvidence: {
        rxBytesFree: 128,
        plannerBlocksFree: 14,
        sessionEpoch: useLaserStore.getState().controllerSessionEpoch,
        observedAt: 1,
      },
      plannerCapacityEvidence: {
        plannerBlocksFree: 15,
        sessionEpoch: useLaserStore.getState().controllerSessionEpoch,
        observedAt: 2,
      },
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
      rxCapacityEvidence: null,
      plannerCapacityEvidence: null,
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

// ADR-639: the operator's Disconnect and Forget Controller pause auto-connect
// for this run from their own handlers. The store's disconnect does not:
// Find my machine's baud scan and "Use a different port…" close the port on
// their way to opening one. Only a connect someone asked for that opened its
// port lifts the pause, so a cancelled picker leaves it set.
describe('the auto-connect pause', () => {
  const openPort = adapterWithRequestPort(async () => ({
    open: async () => ({
      write: async () => undefined,
      onLine: () => () => undefined,
      onClose: () => () => undefined,
      close: async () => undefined,
    }),
  }));
  const cancelledPicker = adapterWithRequestPort(async () => null);
  const paused = (): boolean => useAutoConnectSession.getState().paused;

  beforeEach(() => resetAutoConnectSession());
  afterEach(async () => {
    await useLaserStore
      .getState()
      .disconnect()
      .catch(() => undefined);
    resetAutoConnectSession();
  });

  it('is not set by the store disconnect that the baud scan uses', async () => {
    await useLaserStore.getState().connect(openPort);
    await useLaserStore.getState().disconnect();
    expect(paused()).toBe(false);

    await useLaserStore.getState().connect(openPort);
    await useLaserStore.getState().forgetDevice?.();
    expect(paused()).toBe(false);
  });

  it('is lifted only once a connect someone asked for opens its port', async () => {
    pauseAutoConnect();

    await useLaserStore.getState().connect(cancelledPicker, { portSelection: 'choose' });
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(paused()).toBe(true);

    await useLaserStore.getState().connect(openPort, { portSelection: 'automatic' });
    expect(paused()).toBe(true);

    await useLaserStore.getState().connect(openPort, { portSelection: 'choose' });
    expect(useLaserStore.getState().connection.kind).toBe('connected');
    expect(paused()).toBe(false);
  });
});
