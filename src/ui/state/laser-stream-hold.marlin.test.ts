// Controller audit MA-9: KerfDesk's inline program ends every pass with
// `M5 I`, which Marlin answers only after every buffered move has run
// (M3-M5.cpp L142-L154), printing `echo:busy: processing` every 2 s meanwhile
// (gcode.cpp L1204-L1229). The live bar called that normal drain a controller
// "reporting Idle" and holding the program, the Idle being the pre-job M114,
// and after 90 s raised the stream-stalled safety notice.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator } from '../../__fixtures__/controllers';
import { createFifoMarlin } from '../../__fixtures__/controllers/marlin-fifo-model';
import { grblDriver } from '../../core/controllers';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import { useLaserStore } from './laser-store';
import { STREAM_HOLD_VISIBLE_MS } from './laser-stream-hold';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';

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
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    streamer: null,
    streamHold: null,
    controllerOperation: null,
    log: [],
    transcript: [],
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a Marlin M5 I drain', () => {
  it('is not a held controller while Marlin reports busy', async () => {
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
    expect(laser.transcript.some((entry) => entry.raw === 'echo:busy: processing')).toBe(true);
    expect(laser.safetyNotice?.kind).not.toBe('stream-stalled');
    expect(laser.streamHold ?? null).toBeNull();
  });

  it('never names the pre-job M114 when no busy line arrives', async () => {
    // A build without HOST_KEEPALIVE_FEATURE is silent while M5 I waits.
    const sim = createMarlinSimulator({ motionMs: 10_000, keepaliveMs: 0 });
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
    await vi.advanceTimersByTimeAsync(1_200);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
    await startTestLaserJob('M3 I S0\nG1 X10 F600 S100\nG1 X20\nM5 I\n', {
      streamingMode: 'ping-pong',
    });
    await vi.advanceTimersByTimeAsync(STREAM_HOLD_VISIBLE_MS + 2_000);
    const laser = useLaserStore.getState();
    expect(laser.streamHold).toMatchObject({ controllerState: null, statusNotPolled: true });
    const began = laser.log.find((line) => line.includes('Controller holding program'));
    expect(began).toContain('no status is polled while it streams');
    expect(began).not.toContain('reports Idle');
  });
});
