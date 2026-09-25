// Audit track MA (Marlin), finding MA-9: a normal Marlin job raises the
// "controller has not acknowledged ... while still answering status queries
// (reporting Idle)" safety notice.
//
// KerfDesk's inline program ends every pass/layer with `M5 I`
// (marlin-inline-transform.ts). Marlin's M5 calls planner.synchronize() before
// it answers (control/M3-M5.cpp L142-L154), so that line's `ok` arrives only
// after every buffered move has run — minutes for a slow cut — while Marlin
// prints `echo:busy: processing` every 2 s (gcode.cpp host_keepalive,
// HOST_KEEPALIVE_FEATURE stock). KerfDesk ignores busy lines
// (laser-line-handler.ts `if (cls.kind === 'busy') return;`), does not poll
// M114 while a stream line is unacknowledged (laser-status-polling-policy.ts),
// and so the ack watchdog (laser-stream-hold.ts / laser-stream-stall.ts) shows
// "The controller reports Idle and has not acknowledged ..." after 3 s — the
// Idle is the stale pre-job M114 — and after 90 s raises the `stream-stalled`
// safety notice claiming the controller is "still answering status queries",
// which Marlin is not being asked.
//
// Upstream: https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M3-M5.cpp#L142-L154
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1204-L1229
//
// Correct behaviour: while Marlin keeps sending busy keepalives the job is not
// reported as a held/unresponsive controller (busy counts as liveness), and
// the hold copy never claims a status report the app did not receive.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
import { createFifoMarlin } from './marlin-fifo-model';

const SERPENTINE_CUT: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 80,
      speed: 300,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 50, y: 50 },
            { x: 250, y: 50 },
            { x: 250, y: 55 },
            { x: 50, y: 55 },
            { x: 50, y: 60 },
            { x: 250, y: 60 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({ safetyNotice: null, streamer: null, controllerOperation: null });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MA-9: a normal Marlin M5 I drain looks like a stalled controller', () => {
  it('does not raise stream-stalled while Marlin reports busy', async () => {
    const program = marlinStrategy.emit(SERPENTINE_CUT, {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin',
      maxPowerS: 255,
      gcodeDialect: { dialectId: 'marlin-inline' },
    });
    const marlin = createFifoMarlin();
    await useLaserStore
      .getState()
      .connect(marlin.adapter, { controllerKind: 'marlin', baudRate: 250000 });
    marlin.emitLine('start');
    await vi.advanceTimersByTimeAsync(1_500);
    await startTestLaserJob(program, { streamingMode: 'ping-pong' });

    // 610 mm at 300 mm/min: the pass's closing `M5 I` is answered after ~122 s.
    await vi.advanceTimersByTimeAsync(100_000);
    const laser = useLaserStore.getState();
    expect(laser.streamer?.status).toBe('streaming');
    expect(laser.streamer?.inFlight[0]?.line).toBe('M5 I\n');
    expect(laser.transcript.some((entry) => /busy: processing/.test(JSON.stringify(entry)))).toBe(
      true,
    );
    // Current code: 'stream-stalled' ("... while still answering status queries
    // (reporting Idle)") and a live-bar hold naming a stale Idle report.
    expect(laser.safetyNotice?.kind).not.toBe('stream-stalled');
    expect(laser.streamHold ?? null).toBeNull();
  });
});
