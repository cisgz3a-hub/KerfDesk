import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import { fireActions } from './laser-fire-actions';
import { useLaserStore, type LaserState } from './laser-store';
import { buildPortClosePatch, disconnectStopCommands } from './laser-store-helpers';
import { useStore } from './store';

const originalProject = useStore.getState().project;

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
    fireActive: false,
    accessoryCache: {
      spindleCw: false,
      spindleCcw: false,
      flood: false,
      mist: false,
    },
  };
}

function harness(write = vi.fn(async () => undefined)): {
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
    expect(test.write).toHaveBeenCalledWith('M3 S20\n', 'fire', 'console');
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
      line.startsWith('M3')
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

    expect(write.mock.calls.map(([line]) => line)).toEqual(['M3 S20\n', 'M5\n', 'M5\n']);
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
