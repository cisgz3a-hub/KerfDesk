import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../../platform/types';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../../core/devices/falcon-profiles';
import { ORTUR_LASER_MASTER_3_PROFILES } from '../../../core/devices/brand-laser-profiles';
import { useLaserStore } from '../../state/laser-store';
import { flushConnect } from '../../state/laser-store-console.test-support';
import { useStore } from '../../state/store';
import { resetStore } from '../../state/test-helpers';
import { useToastStore } from '../../state/toast-store';
import { saveDriverSwitchBlocker, switchDriverAfterSave } from './save-driver-switch';

type Fake = SerialConnection & { emit: (line: string) => void; writes: string[] };

function controller(): Fake {
  const handlers = new Set<(line: string) => void>();
  const emit = (line: string): void => handlers.forEach((handler) => handler(line));
  const writes: string[] = [];
  const later = (lines: string[]): void =>
    queueMicrotask(() => queueMicrotask(() => lines.forEach(emit)));
  return {
    emit,
    writes,
    write: async (data) => {
      writes.push(data);
      if (data === '?') return later(['<Idle|MPos:0.000,0.000,0.000|FS:0,0>']);
      if (data === '$I\n') return later(['[VER:1.1h.20190830:test]', '[OPT:VM,15,128]', 'ok']);
      if (data === '$G\n') return later(['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]', 'ok']);
      if (data === '$$\n') return later(['$30=1000', '$31=0', '$32=1', 'ok']);
      if (data.endsWith('\n')) later(['ok']);
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
  };
}

function platform(next: () => Fake): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({
        open: async () => {
          const fake = next();
          // The banner and first report arrive after the port opens.
          setTimeout(() => {
            fake.emit("Grbl 1.1h ['$' for help]");
            fake.emit('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
          }, 0);
          return fake;
        },
      }),
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushConnect();
  }
}

async function connectStockGrbl(adapter: PlatformAdapter): Promise<void> {
  await useLaserStore.getState().connect(adapter);
  await settle();
  expect(useLaserStore.getState().connection.kind).toBe('connected');
  expect(useLaserStore.getState().controllerOperation).toBeNull();
  expect(useLaserStore.getState().activeControllerKind).toBe('grbl-v1.1');
}

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useToastStore.setState({ toasts: [] });
  resetStore();
});

describe('Machine Setup Save switches the live driver (U2-P2-1)', () => {
  it('reconnects a stock GRBL session with the saved Falcon A1 Pro command set', async () => {
    resetStore();
    const opened: Fake[] = [];
    const adapter = platform(() => {
      const fake = controller();
      opened.push(fake);
      return fake;
    });
    await connectStockGrbl(adapter);
    useStore.getState().replaceDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);

    const outcome = await switchDriverAfterSave(adapter);

    expect(outcome.kind).toBe('reconnected');
    expect(opened).toHaveLength(2);
    const laser = useLaserStore.getState();
    expect(laser.connection.kind).toBe('connected');
    expect(laser.activeControllerKind).toBe('grblhal');
    expect(laser.activeControllerCommandSet).toBe('creality-falcon-a1-pro');
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
      'Reconnected with the Falcon A1 Pro (GRBL-compatible commands), as the saved machine uses.',
    );
  });

  it('reconnects an Ortur LM3 with the grblHAL driver', async () => {
    resetStore();
    const adapter = platform(controller);
    await connectStockGrbl(adapter);
    useStore.getState().replaceDeviceProfile(ORTUR_LASER_MASTER_3_PROFILES[0]!);
    expect((await switchDriverAfterSave(adapter)).kind).toBe('reconnected');
    expect(useLaserStore.getState().activeControllerKind).toBe('grblhal');
    expect(useLaserStore.getState().activeControllerCommandSet ?? null).toBeNull();
  });

  // Marlin answered nothing on the stock GRBL driver ("Machine stopped
  // answering"); a CNC that is not listed can name FluidNC. Both families
  // differ from the starter's, so Save reopens the port with their driver.
  it.each([
    ['Marlin laser', { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'marlin' as const }],
    ['FluidNC CNC', { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'fluidnc' as const }],
  ])('reconnects a %s with its own driver', async (_name, profile) => {
    resetStore();
    const adapter = platform(controller);
    await connectStockGrbl(adapter);
    useStore.getState().replaceDeviceProfile(profile);
    expect((await switchDriverAfterSave(adapter)).kind).toBe('reconnected');
    expect(useLaserStore.getState().activeControllerKind).toBe(profile.controllerKind);
  });

  it('keeps a moving machine connected, says why, and points at Reconnect now', async () => {
    resetStore();
    let opens = 0;
    const adapter = platform(() => {
      opens += 1;
      return controller();
    });
    await connectStockGrbl(adapter);
    useStore.getState().replaceDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
    const report = useLaserStore.getState().statusReport;
    expect(report).not.toBeNull();
    useLaserStore.setState({ statusReport: { ...report!, state: 'Jog' } });

    const outcome = await switchDriverAfterSave(adapter);

    expect(outcome).toMatchObject({ kind: 'deferred', reason: 'the controller reports Jog' });
    expect(opens).toBe(1);
    expect(useLaserStore.getState().activeControllerKind).toBe('grbl-v1.1');
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Machine Setup saved. KerfDesk is still connected with the generic GRBL v1.1 commands ' +
        'because the controller reports Jog, so Home, jog and Frame use them. Press Reconnect now ' +
        'in the machine toolbar to use the Falcon A1 Pro (GRBL-compatible commands).',
    );
  });

  it('does nothing when the live driver already matches', async () => {
    resetStore();
    const adapter = platform(controller);
    await connectStockGrbl(adapter);
    expect((await switchDriverAfterSave(adapter)).kind).toBe('not-needed');
  });
});

describe('saveDriverSwitchBlocker', () => {
  const rest = {
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    statusReport: null,
    lastConnectionTransport: 'serial' as const,
  };

  it('allows Idle, Alarm and a silent firmware the old driver cannot parse', () => {
    expect(saveDriverSwitchBlocker(rest, true)).toBeNull();
    for (const state of ['Idle', 'Alarm'] as const) {
      const statusReport = { state } as NonNullable<
        Parameters<typeof saveDriverSwitchBlocker>[0]['statusReport']
      >;
      expect(saveDriverSwitchBlocker({ ...rest, statusReport }, true)).toBeNull();
    }
  });

  it('refuses a network session and a host without a platform', () => {
    expect(saveDriverSwitchBlocker({ ...rest, lastConnectionTransport: 'tcp' }, true)).toBe(
      'a network connection reopens only from its own Connect',
    );
    expect(saveDriverSwitchBlocker(rest, false)).toBe('this window cannot reopen the port');
  });
});
