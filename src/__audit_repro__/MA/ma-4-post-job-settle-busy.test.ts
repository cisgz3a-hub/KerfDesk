// Audit track MA (Marlin), finding MA-4: the post-job M400 settle gives up
// after a fixed 30 s on Marlin even while the controller keeps reporting
// `echo:busy: processing`, so a job whose last buffered motion takes longer
// than 30 s ends with "Post-job controller settle failed".
//
// laser-post-job-settle.ts sends the driver's settle marker (M400 on Marlin)
// with timeoutMs 30_000 and timeoutMode 'non-idle-status-activity'. That mode
// is kept alive only by non-Idle status reports (laser-interactive-command.ts
// keepCommandAliveFromStatus). Marlin produces none: the queued M114 poll is
// suppressed while the M400 is owed (laser-status-polling-policy.ts
// canSendQueuedStatusQuery), and a synthesized Marlin report is always Idle.
// Marlin's own liveness signal, the host keepalive, is classified `busy` and
// discarded (laser-line-handler.ts `if (cls.kind === 'busy') return;`).
//
// Upstream: M400 is `planner.synchronize()` (gcode/motion/M400.cpp); the ok is
// sent only after the planner drains. While a handler waits, idle() calls
// GcodeSuite::host_keepalive(), which prints "echo:busy: processing" every
// DEFAULT_KEEPALIVE_INTERVAL (2 s, HOST_KEEPALIVE_FEATURE on in the stock
// Configuration.h). A slow final move is ordinary on Marlin: without
// G0_FEEDRATE (stock) the program's closing `G0 X0 Y0` park runs at the last G1
// feed, e.g. 360 mm at 300 mm/min is 72 s (G0_G1.cpp; motion.cpp feedrate_mm_s).
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/motion/M400.cpp#L29-L33
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1204-L1229
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/Configuration.h#L2228-L2229
//
// Correct behaviour: a Marlin settle marker that is still producing busy
// keepalives is not timed out; the job completes once M400 is acknowledged and
// Idle follows.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import { createFifoMarlin } from './marlin-fifo-model';
import { laserCountdownTestHandoff } from '../../ui/state/laser-countdown-test-handoff';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';

const LONG_FINAL_MOVE_JOB = 'G1 X10 Y0 F300 S100\n';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    lastWriteError: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    liveCanvasRun: null,
    log: [],
    transcript: [],
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MA-4: Marlin post-job settle ignores busy keepalives', () => {
  it('completes a job whose final buffered move outlasts 30 s', async () => {
    // The final move takes 72 s after its ok (planned, not yet executed).
    const sim = createMarlinSimulator({ motionMs: 72_000 });
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
    await vi.advanceTimersByTimeAsync(1_200);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    // Marlin's host keepalive while a handler (here M400) blocks.
    const keepalive = setInterval(() => {
      const waitingOnM400 =
        sim.state().pendingMotions > 0 && sim.outbound().includes('M400\n');
      if (waitingOnM400) sim.port.emitLine('echo:busy: processing');
    }, 2_000);

    await startTestLaserJob(LONG_FINAL_MOVE_JOB, {
      streamingMode: 'ping-pong',
      ...laserCountdownTestHandoff({
        gcode: LONG_FINAL_MOVE_JOB,
        retentionKey: 'ma-4',
        capability: 'settle-only',
      }),
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(useLaserStore.getState().controllerOperation).toMatchObject({ kind: 'post-job-settle' });

    await vi.advanceTimersByTimeAsync(80_000);
    clearInterval(keepalive);
    expect(sim.state().pendingMotions).toBe(0);

    const laser = useLaserStore.getState();
    // Current code: "post-job settle marker timed out." at 30 s.
    expect(laser.log.some((line) => /Post-job controller settle failed/.test(line))).toBe(false);
    expect(laser.safetyNotice).toBeNull();
    expect(laser.liveCanvasRun?.timing).toMatchObject({ kind: 'complete' });
  });

  it('completes KerfDesk\'s own program whose closing park runs at the cut feed', async () => {
    // A 60 mm cut at 300 mm/min ending at (260, 200): the emitted program
    // closes with `M5 I` then `G0 X0.000 Y0.000 S0`. Without G0_FEEDRATE that
    // park runs at the modal 300 mm/min: 328 mm, about 66 s after its `ok`.
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
    expect(program.trimEnd().split('\n').slice(-2)).toEqual(['M5 I', 'G0 X0.000 Y0.000 S0']);

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
    // Current code: the M400 settle times out at 30 s while Marlin is still
    // parking and printing `echo:busy: processing` every 2 s.
    expect(laser.log.some((line) => /Post-job controller settle failed/.test(line))).toBe(false);
    expect(laser.liveCanvasRun?.timing).toMatchObject({ kind: 'complete' });
  });
});
