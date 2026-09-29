import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import { fireActions } from './laser-fire-actions';
import { useLaserStore, type LaserState } from './laser-store';
import { buildPortClosePatch, disconnectStopCommands } from './laser-store-helpers';
import { useStore } from './store';

const originalProject = useStore.getState().project;
// G1 selects a laser-cut motion mode so GRBL laser mode lights a stationary
// M3; F defines the feed an explicit G1 needs (laser-fire-modal-state.test.ts
// checks these bytes against a port of GRBL's laser-mode parser).
const FIRE_ON = 'G1 F1000 M3 S20\n';
const SPINDLE_OV_RESET = '\x99';

function readyState(): LaserState {
  return {
    ...useLaserStore.getState(),
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
      pins: null,
      ov: null,
    },
    alarmCode: null,
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    probeBusy: false,
    pendingUntrackedAcks: 0,
    // A controller known to be at 100% power override, so Fire needs no reset
    // first; the reset cases below set their own override state.
    ovCache: { feed: 100, rapid: 100, spindle: 100 },
    fireActive: false,
    accessoryCache: {
      spindleCw: false,
      spindleCcw: false,
      flood: false,
      mist: false,
    },
  };
}

function harness(write = vi.fn<Parameters<typeof fireActions>[2]>(async () => undefined)): {
  readonly get: () => LaserState;
  readonly setFireActive: LaserState['setFireActive'];
  readonly write: typeof write;
} {
  let state = readyState();
  const set = (
    partial: Partial<LaserState> | ((current: LaserState) => Partial<LaserState> | LaserState),
  ): void => {
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
  };
  const get = (): LaserState => state;
  return { get, setFireActive: fireActions(set, get, write).setFireActive, write };
}

beforeEach(() => {
  useStore.setState({
    project: {
      ...originalProject,
      machine: { kind: 'laser' },
      device: {
        ...originalProject.device,
        capabilities: [...(originalProject.device.capabilities ?? []), 'low-power-fire'],
        fireControl: { enabled: true, maxPowerPercent: 2 },
        maxPowerS: 1000,
        framingFeedMmPerMin: 1000,
      },
    },
  });
  useExperimentalLaserFeatures.getState().resetFeatures();
  useExperimentalLaserFeatures.getState().setFeature('lowPowerFire', true);
});

afterEach(() => {
  useStore.setState({ project: originalProject });
  useExperimentalLaserFeatures.getState().resetFeatures();
});

describe('momentary low-power Fire action', () => {
  it('writes capped M3 power on press and M5 on release', async () => {
    const test = harness();

    await test.setFireActive(true, 50);
    expect(test.write).toHaveBeenCalledWith(FIRE_ON, 'fire', 'console');
    expect(test.get().fireActive).toBe(true);
    expect(test.get().accessoryCache).toBeNull();

    await test.setFireActive(false);
    expect(test.write).toHaveBeenLastCalledWith('M5\n', 'fire', 'console');
    expect(test.get().fireActive).toBe(false);
  });

  it('fails closed when the Labs gate is off', async () => {
    useExperimentalLaserFeatures.getState().setFeature('lowPowerFire', false);
    const test = harness();

    await expect(test.setFireActive(true)).rejects.toThrow('Tools > Labs');
    expect(test.write).not.toHaveBeenCalled();
    expect(test.get().fireActive).toBe(false);
  });

  it('requires an Idle report with a known position', async () => {
    const test = harness();
    const current = test.get();
    Object.assign(current, {
      statusReport: { ...current.statusReport, mPos: null, wPos: null },
    });

    await expect(test.setFireActive(true)).rejects.toThrow('trusted live position');
    expect(test.write).not.toHaveBeenCalled();
  });

  it('finishes with M5 when release wins an in-flight activation', async () => {
    let resolveStart: (() => void) | undefined;
    const write = vi.fn((line: string) =>
      line === FIRE_ON
        ? new Promise<void>((resolve) => {
            resolveStart = resolve;
          })
        : Promise.resolve(),
    );
    const test = harness(write);

    const starting = test.setFireActive(true);
    const stopping = test.setFireActive(false);
    await stopping;
    resolveStart?.();
    await starting;

    expect(write.mock.calls.map(([line]) => line)).toEqual([FIRE_ON, 'M5\n', 'M5\n']);
    expect(test.get().fireActive).toBe(false);
  });

  it('compensates with M5 when MPG takeover wins an in-flight activation', async () => {
    let resolveStart: (() => void) | undefined;
    const write = vi.fn((line: string) =>
      line === FIRE_ON
        ? new Promise<void>((resolve) => {
            resolveStart = resolve;
          })
        : Promise.resolve(),
    );
    const test = harness(write);

    const starting = test.setFireActive(true);
    expect(test.get().fireActive).toBe(true);
    Object.assign(test.get(), { mpgActive: true });
    resolveStart?.();
    await starting;

    expect(write.mock.calls.map(([line]) => line)).toEqual([FIRE_ON, 'M5\n']);
    expect(test.get().fireActive).toBe(false);
  });

  it('keeps the OFF latch when the M5 write fails and resends M5 on retry', async () => {
    let failNextOff = true;
    const write = vi.fn(async (line: string) => {
      if (line === 'M5\n' && failNextOff) {
        failNextOff = false;
        throw new Error('Port write failed.');
      }
    });
    const test = harness(write);
    await test.setFireActive(true);
    expect(test.get().fireActive).toBe(true);

    await expect(test.setFireActive(false)).rejects.toThrow('Port write failed.');
    // The beam may still be on: the latch (and the LASER OFF affordance keyed
    // on it) must survive until an M5 write actually succeeds.
    expect(test.get().fireActive).toBe(true);

    await test.setFireActive(false);
    expect(write.mock.calls.filter(([line]) => line === 'M5\n')).toHaveLength(2);
    expect(test.get().fireActive).toBe(false);
  });

  it('retains the uncertain Fire-on latch when the activation write rejects', async () => {
    const write = vi.fn(async (line: string) => {
      if (line === FIRE_ON) throw new Error('ambiguous activation write');
    });
    const test = harness(write);

    await expect(test.setFireActive(true)).rejects.toThrow('ambiguous activation write');

    expect(test.get().fireActive).toBe(true);
    await test.setFireActive(false);
    expect(write).toHaveBeenLastCalledWith('M5\n', 'fire', 'console');
    expect(test.get().fireActive).toBe(false);
  });

  // The controller scales S by its power override (GRBL spindle_control.c#L195,
  // grblHAL spindle_control.c#L867-L868), so an override left at 200% by a job
  // doubled Fire's capped S (controller audit P-2).
  it('resets a leftover power override before Fire-on', async () => {
    const test = harness();
    Object.assign(test.get(), { ovCache: { feed: 100, rapid: 100, spindle: 200 } });

    await test.setFireActive(true);

    expect(test.write.mock.calls).toEqual([
      [SPINDLE_OV_RESET, 'fire', 'console'],
      [FIRE_ON, 'fire', 'console'],
    ]);
    expect(test.get().fireActive).toBe(true);
    expect(test.get().log).toContain(
      '[lf2] Reset the power override to 100% before Fire (was 200%).',
    );
  });

  it('resets an override not reported yet this session, like Start does', async () => {
    const test = harness();
    Object.assign(test.get(), { ovCache: null });

    await test.setFireActive(true);

    expect(test.write.mock.calls.map(([line]) => line)).toEqual([SPINDLE_OV_RESET, FIRE_ON]);
  });

  it('leaves feed and rapid alone and sends nothing extra at 100% power', async () => {
    const test = harness();
    Object.assign(test.get(), { ovCache: { feed: 50, rapid: 25, spindle: 100 } });

    await test.setFireActive(true);

    expect(test.write.mock.calls.map(([line]) => line)).toEqual([FIRE_ON]);
  });

  it('sends no override byte to a controller without realtime overrides', async () => {
    const test = harness();
    const current = test.get();
    Object.assign(current, {
      ovCache: null,
      capabilities: { ...current.capabilities, overrides: false },
    });

    await test.setFireActive(true);

    expect(test.write.mock.calls.map(([line]) => line)).toEqual([FIRE_ON]);
  });

  it('never writes Fire-on when release wins the override reset', async () => {
    let resolveReset: (() => void) | undefined;
    const write = vi.fn((line: string) =>
      line === SPINDLE_OV_RESET
        ? new Promise<void>((resolve) => {
            resolveReset = resolve;
          })
        : Promise.resolve(),
    );
    const test = harness(write);
    Object.assign(test.get(), { ovCache: null });

    const starting = test.setFireActive(true);
    await test.setFireActive(false);
    resolveReset?.();
    await starting;

    expect(write.mock.calls.map(([line]) => line)).toEqual([SPINDLE_OV_RESET, 'M5\n']);
    expect(test.get().fireActive).toBe(false);
  });

  it('never writes Fire-on when the controller leaves Idle during the reset', async () => {
    let resolveReset: (() => void) | undefined;
    const write = vi.fn((line: string) =>
      line === SPINDLE_OV_RESET
        ? new Promise<void>((resolve) => {
            resolveReset = resolve;
          })
        : Promise.resolve(),
    );
    const test = harness(write);
    const current = test.get();
    Object.assign(current, { ovCache: null });

    const starting = test.setFireActive(true);
    Object.assign(test.get(), { statusReport: { ...current.statusReport, state: 'Alarm' } });
    resolveReset?.();
    await starting;

    expect(write.mock.calls.map(([line]) => line)).toEqual([SPINDLE_OV_RESET]);
    expect(test.get().fireActive).toBe(false);
  });

  it('drops the latch without M5 when the reset write fails before Fire-on', async () => {
    const write = vi.fn(async (line: string) => {
      if (line === SPINDLE_OV_RESET) throw new Error('Port write failed.');
    });
    const test = harness(write);
    Object.assign(test.get(), { ovCache: null });

    await expect(test.setFireActive(true)).rejects.toThrow('Port write failed.');

    expect(write.mock.calls.map(([line]) => line)).toEqual([SPINDLE_OV_RESET]);
    expect(test.get().fireActive).toBe(false);
  });

  it('includes M5 in disconnect cleanup and treats a dropped Fire link as unsafe', async () => {
    const test = harness();
    await test.setFireActive(true);

    expect(disconnectStopCommands(test.get(), grblDriver)).toContain('M5\n');
    expect(buildPortClosePatch(test.get())).toMatchObject({
      fireActive: false,
      safetyNotice: { kind: 'disconnect-during-fire' },
    });
  });
});
