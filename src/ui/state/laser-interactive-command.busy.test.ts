// Controller audit MA-4: Marlin answers M400 (the post-job settle marker) and
// G28 only once their work is done, and prints `echo:busy: processing` every
// 2 s meanwhile (M400.cpp L29-L33; gcode.cpp host_keepalive L1204-L1229;
// Configuration.h L2228-L2229). No M114 is polled while such a command is
// owed, so only the busy line shows the controller is working: it now keeps
// an activity-timed command alive, as a non-Idle status report does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator } from '../../__fixtures__/controllers';
import { createFifoMarlin } from '../../__fixtures__/controllers/marlin-fifo-model';
import { grblDriver } from '../../core/controllers';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import {
  consumeControllerCommandResponse,
  startControllerCommand,
} from './laser-interactive-command';
import { laserCountdownTestHandoff } from './laser-countdown-test-handoff';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { disconnectOnTestClock } from './laser-disconnect-testing';

const BUSY = { kind: 'busy' } as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    controllerOperation: null,
    streamer: null,
    liveCanvasRun: null,
    homingState: 'unknown',
    log: [],
    transcript: [],
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('busy keepalives and an owned command', () => {
  it('keep an activity-timed command alive past its timeout', async () => {
    const { refs } = makeLineHandlerHarness();
    const outcome = startControllerCommand(refs, async () => undefined, {
      kind: 'post-job-settle',
      label: 'post-job settle marker',
      command: 'M400\n',
      timeoutMs: 30_000,
      timeoutMode: 'non-idle-status-activity',
    }).then(() => 'resolved', messageOf);
    await Promise.resolve();
    for (let elapsed = 0; elapsed < 80_000; elapsed += 2_000) {
      await vi.advanceTimersByTimeAsync(2_000);
      consumeControllerCommandResponse(refs, BUSY, 'echo:busy: processing');
    }
    consumeControllerCommandResponse(refs, { kind: 'ok' }, 'ok');
    expect(await outcome).toBe('resolved');
  });

  it('do not extend a command with a fixed timeout', async () => {
    const { refs } = makeLineHandlerHarness();
    const outcome = startControllerCommand(refs, async () => undefined, {
      kind: 'interactive-command',
      label: 'probe',
      command: 'M400\n',
      timeoutMs: 3_000,
    }).then(() => 'resolved', messageOf);
    await Promise.resolve();
    for (let elapsed = 0; elapsed < 4_000; elapsed += 1_000) {
      await vi.advanceTimersByTimeAsync(1_000);
      consumeControllerCommandResponse(refs, BUSY, 'echo:busy: processing');
    }
    expect(await outcome).toBe('probe timed out.');
  });
});

describe('Marlin post-job settle and Home through a long drain', () => {
  it('completes a job whose final buffered move outlasts 30 s', async () => {
    const job = 'G1 X10 Y0 F300 S100\n';
    const sim = createMarlinSimulator({ motionMs: 72_000 });
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
    await vi.advanceTimersByTimeAsync(1_200);
    await startTestLaserJob(job, {
      streamingMode: 'ping-pong',
      ...laserCountdownTestHandoff({ gcode: job, retentionKey: 'ma-4', capability: 'settle-only' }),
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(useLaserStore.getState().controllerOperation).toMatchObject({ kind: 'post-job-settle' });

    await vi.advanceTimersByTimeAsync(80_000);
    const laser = useLaserStore.getState();
    expect(laser.transcript.some((entry) => entry.raw === 'echo:busy: processing')).toBe(true);
    expect(laser.log.some((line) => /Post-job controller settle failed/.test(line))).toBe(false);
    expect(laser.safetyNotice).toBeNull();
    expect(laser.liveCanvasRun?.timing).toMatchObject({ kind: 'complete' });
  });

  it("completes KerfDesk's own program, whose closing park carries the travel feed", async () => {
    // A 60 mm cut at 300 mm/min ending at (260, 200). Stock Marlin has no
    // G0_FEEDRATE, so a bare G0 runs at the modal feed; the closing park used to
    // take the 300 mm/min cut feed, 328 mm or about 66 s after its `ok`. Travel
    // now carries its own feed (MA-8).
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'L1',
          color: '#ff0000',
          power: 50,
          speed: 300,
          passes: 1,
          airAssist: false,
          segments: [
            {
              polyline: [
                { x: 200, y: 200 },
                { x: 260, y: 200 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    const program = marlinStrategy.emit(job, {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin',
      maxPowerS: 255,
      gcodeDialect: { dialectId: 'marlin-inline' },
    });
    expect(program.trimEnd().split('\n').slice(-2)).toEqual(['M5 I', 'G0 X0.000 Y0.000 F6000 S0']);
    const marlin = createFifoMarlin();
    await useLaserStore
      .getState()
      .connect(marlin.adapter, { controllerKind: 'marlin', baudRate: 250000 });
    marlin.emitLine('start');
    await vi.advanceTimersByTimeAsync(1_500);
    await startTestLaserJob(program, {
      streamingMode: 'ping-pong',
      ...laserCountdownTestHandoff({
        gcode: program,
        retentionKey: 'ma-4-fifo',
        capability: 'settle-only',
      }),
    });
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(marlin.state().plannedBlocks).toBe(0);
    const laser = useLaserStore.getState();
    expect(laser.safetyNotice).toBeNull();
    expect(laser.liveCanvasRun?.timing).toMatchObject({ kind: 'complete' });
  });

  it('confirms a Home whose G28 outlasts the command budget while Marlin reports busy', async () => {
    const sim = createMarlinSimulator({ homingMs: 150_000 });
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
    await vi.advanceTimersByTimeAsync(1_200);
    const home = useLaserStore
      .getState()
      .home()
      .then(() => 'homed', messageOf);
    await vi.advanceTimersByTimeAsync(155_000);
    expect(await home).toBe('homed');
    expect(useLaserStore.getState().homingState).toBe('confirmed');
  });
});
