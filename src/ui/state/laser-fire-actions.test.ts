import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { createStreamer } from '../../core/controllers/grbl';
import { fireActions } from './laser-fire-actions';
import { useLaserStore, type LaserState } from './laser-store';
import { buildPortClosePatch, disconnectStopCommands } from './laser-store-helpers';
import { useStore } from './store';

const originalProject = useStore.getState().project;
// G1 selects a laser-cut motion mode so GRBL laser mode lights a stationary
// M3; F defines the feed an explicit G1 needs (laser-fire-modal-state.test.ts
// checks these bytes against a port of GRBL's laser-mode parser).
const FIRE_ON = 'G1 F1000 M3 S20\n';

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

// No Labs switch and no catalog `low-power-fire` capability: the machine's own
// opt-in is the whole consent now (ADR-387).
function installFireControl(fireControl: { enabled: boolean; maxPowerPercent: number }): void {
  useStore.setState({
    project: {
      ...originalProject,
      machine: { kind: 'laser' },
      device: {
        ...originalProject.device,
        fireControl,
        maxPowerS: 1000,
        framingFeedMmPerMin: 1000,
      },
    },
  });
}

beforeEach(() => {
  localStorage.clear();
  installFireControl({ enabled: true, maxPowerPercent: 2 });
});

afterEach(() => {
  useStore.setState({ project: originalProject });
  localStorage.clear();
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

  it('fails closed until the machine opts in', async () => {
    installFireControl({ enabled: false, maxPowerPercent: 2 });
    const test = harness();

    await expect(test.setFireActive(true)).rejects.toThrow('Enable Fire button');
    expect(test.write).not.toHaveBeenCalled();
    expect(test.get().fireActive).toBe(false);
  });

  it('ignores a retired Labs Fire switch left in storage', async () => {
    localStorage.setItem(
      'kerfdesk.experimental-laser-features.v1',
      JSON.stringify({ lowPowerFire: false, printAndCut: false, cameraAlignmentV2: false }),
    );
    const test = harness();

    await test.setFireActive(true);
    expect(test.write).toHaveBeenCalledWith(FIRE_ON, 'fire', 'console');
  });

  it('never sends more than the absolute 5% ceiling, whatever the profile holds', async () => {
    // A value the normalizers would reject, planted as if it bypassed them.
    installFireControl({ enabled: true, maxPowerPercent: 50 });
    const test = harness();

    await test.setFireActive(true, 50);
    expect(test.write).toHaveBeenCalledWith('G1 F1000 M3 S50\n', 'fire', 'console');
  });

  it('refuses every ADR-162 precondition without writing anything', async () => {
    const refusals: ReadonlyArray<readonly [string, Partial<LaserState>]> = [
      ['Connect to the laser first.', { connection: { kind: 'disconnected' } }],
      ['Clear the controller alarm', { alarmCode: 1 }],
      ['A job is active', { streamer: { ...createStreamer('G1 X1\n'), status: 'streaming' } }],
      ['auto-focus', { autofocusBusy: true }],
      ['probing', { probeBusy: true }],
      ['acknowledge the previous command', { pendingUntrackedAcks: 1 }],
    ];
    for (const [message, patch] of refusals) {
      const test = harness();
      Object.assign(test.get(), patch);

      await expect(test.setFireActive(true), message).rejects.toThrow(message);
      expect(test.write, message).not.toHaveBeenCalled();
      expect(test.get().fireActive, message).toBe(false);
      expect(test.get().lastWriteError, message).toContain(message);
    }
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

  it('keeps the on latch when a repeat press is refused', async () => {
    const test = harness();
    await test.setFireActive(true);
    Object.assign(test.get(), { pendingUntrackedAcks: 1 });

    await expect(test.setFireActive(true)).rejects.toThrow('acknowledge');
    // The accepted M3 may still hold the beam on: LASER OFF and the release
    // M5 both key on this latch.
    expect(test.get().fireActive).toBe(true);

    await test.setFireActive(false);
    expect(test.write).toHaveBeenLastCalledWith('M5\n', 'fire', 'console');
    expect(test.get().fireActive).toBe(false);
  });

  it('compensates with M5 when the machine opt-in is withdrawn during activation', async () => {
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
    installFireControl({ enabled: false, maxPowerPercent: 2 });
    resolveStart?.();
    await starting;

    expect(write.mock.calls.map(([line]) => line)).toEqual([FIRE_ON, 'M5\n']);
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
