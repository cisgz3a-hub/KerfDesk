import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { createStreamer, parseStatusReport } from '../../core/controllers/grbl';
import { liftPausedCncJob } from './cnc-pause-lift';
import type { CncPauseLiftContext } from './cnc-pause-lift-commands';
import { observeControllerResetBoundary } from './laser-controller-reset-wait';
import { observeFreshControllerStatus } from './laser-controller-status-wait';
import { consumeControllerCommandResponse } from './laser-interactive-command';
import type { LaserState } from './laser-store';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const PROGRAM = 'G21\nG90\nG54\nG0 Z5\nM3 S12000\nG4 P1\nG1 Z-1 F150\nG1 X20 F600\n';
const MODAL = 'G21 G90 G54 G94 G17\n';

// Exercise real lift planning, command acknowledgements and fresh-status waits.
// This small controller script adds the startup-WCS switch that the general
// simulator does not model: the paused G54+G92 frame has WCO Z10; reset drops
// G92 and startup selects G55 (also Z10), but selecting G54 changes WCO to Z0.
function startupFrame(options: { omitPostModalWco?: boolean; sameG54?: boolean } = {}) {
  let machineZ = 9; // Paused work Z-1 in the saved WCO Z10 frame.
  let offsetZ = 10;
  let rebooted = false;
  let selectedG54 = false;
  const writes: string[] = [];
  const liftTargets: number[] = [];
  const streamer = createStreamer(PROGRAM);
  const report = () => {
    const wco = options.omitPostModalWco && selectedG54 ? '' : `|WCO:0,0,${offsetZ}`;
    const parsed = parseStatusReport(
      `<${rebooted ? 'Idle' : 'Door:0'}|MPos:10,0,${machineZ}${wco}|FS:0,0>`,
    );
    if (parsed === null) throw new Error('Invalid scripted status');
    return parsed;
  };
  let state = {
    activeJobMachineKind: 'cnc',
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'connected' },
    controllerSettings: { laserModeEnabled: false, reportInches: false },
    controllerSessionEpoch: 1,
    statusSequence: 1,
    statusReport: report(),
    wcoCache: { x: 0, y: 0, z: 10 },
    streamer: {
      ...streamer,
      status: 'paused',
      completed: streamer.queued.length,
      queueIndex: streamer.queued.length,
    },
    streamerEpoch: 1,
    cncPauseLift: null,
    workOriginActive: true,
    workOriginSource: 'g92',
    log: [],
    safetyNotice: null,
  } as unknown as LaserState;
  const refs: CncPauseLiftContext['refs'] = {
    driver: grblDriver,
    controllerCommand: null,
    controllerIdleWait: null,
    writeEpoch: 0,
  };
  const failDarkStop = vi.fn(async () => undefined);
  const context: CncPauseLiftContext = {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    },
    refs,
    driver: () => grblDriver,
    failDarkStop,
    safeWrite: async (line) => {
      writes.push(line);
      if (line === '\x18') {
        rebooted = true;
        refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
        observeControllerResetBoundary(refs);
        return;
      }
      if (line === MODAL) {
        selectedG54 = true;
        offsetZ = options.sameG54 ? 10 : 0;
      } else if (line.startsWith('G92 ')) {
        offsetZ = machineZ - Number(/Z(-?[\d.]+)/.exec(line)?.[1]);
      } else if (line.startsWith('G0 Z')) {
        machineZ = offsetZ + Number(/Z(-?[\d.]+)/.exec(line)?.[1]);
        liftTargets.push(machineZ);
      }
      queueMicrotask(() => consumeControllerCommandResponse(refs, { kind: 'ok' }, 'ok'));
    },
  };
  setInterval(() => {
    const fresh = report();
    state = { ...state, statusReport: fresh, statusSequence: state.statusSequence + 1 };
    if (fresh.wco !== null) state = { ...state, wcoCache: fresh.wco };
    observeFreshControllerStatus(
      refs,
      {
        sessionEpoch: state.controllerSessionEpoch,
        sequence: state.statusSequence,
      },
      fresh,
    );
  }, 100);
  return { context, writes, liftTargets, failDarkStop, read: () => state };
}

async function finish(action: Promise<void>): Promise<void> {
  let done = false;
  const tracked = action.finally(() => {
    done = true;
  });
  tracked.catch(() => undefined);
  for (let elapsed = 0; elapsed < 70_000 && !done; elapsed += 100) {
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(done).toBe(true);
  await tracked;
}

describe('Pause lift restores the frame selected after startup', () => {
  it('restores G92 after G54 changes an initially matching startup WCO, before moving', async () => {
    const controller = startupFrame();
    await finish(liftPausedCncJob(controller.context));
    expect(controller.liftTargets).toEqual([15]);
    expect(controller.writes).toEqual([
      '\x18',
      MODAL,
      'G92 X10.000 Y0.000 Z-1.000\n',
      'G0 Z5.000\n',
    ]);
    expect(controller.read().cncPauseLift?.phase).toBe('lifted');
    expect(controller.failDarkStop).not.toHaveBeenCalled();
  });

  it('never sends a lift without a fresh WCO after selecting G54', async () => {
    const controller = startupFrame({ omitPostModalWco: true });
    await finish(liftPausedCncJob(controller.context));
    expect(controller.liftTargets).toEqual([]);
    expect(controller.writes).toEqual(['\x18', MODAL]);
    expect(controller.failDarkStop).toHaveBeenCalledOnce();
    expect(controller.read().safetyNotice?.kind).toBe('cnc-pause-lift-failed');
  });

  it('does not rewrite an offset that still matches after selecting G54', async () => {
    const controller = startupFrame({ sameG54: true });
    await finish(liftPausedCncJob(controller.context));
    expect(controller.liftTargets).toEqual([15]);
    expect(controller.writes).toEqual(['\x18', MODAL, 'G0 Z5.000\n']);
    expect(controller.read().cncPauseLift?.phase).toBe('lifted');
  });
});
