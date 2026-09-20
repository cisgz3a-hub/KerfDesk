import { afterEach, describe, expect, it, vi } from 'vitest';
import { grblDriver, marlinDriver, smoothiewareDriver } from '../../core/controllers';
import { createStreamer, onAck, pause, step, type StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildGcodeTimingPlan } from '../../core/gcode-time';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import type { CanvasMotionPlan } from './canvas-motion-plan';
import { runConfirmedPauseJob } from './laser-job-pause-resume';
import { useLaserStore, type LaserState } from './laser-store';
import { liveCanvasStartPatch, liveCanvasStatusPatch } from './live-canvas-run';
import { describeLiveJobTiming } from './live-job-timing';

const GCODE = 'G21\nG90\nG1 X100 F600\nG1 X200 F600\nM5';
const ORIGIN = { x: 0, y: 0, z: 0 };

function initialState(): LaserState {
  const plan: CanvasMotionPlan = {
    manifest: buildMotionManifest(GCODE, { machineKind: 'laser', initialPosition: ORIGIN }),
    fingerprint: fingerprintGcode(GCODE),
    retentionKey: 'pause-countdown',
    machineKind: 'laser',
    device: DEFAULT_DEVICE_PROFILE,
    coordinateFrame: { kind: 'machine', workOffsetMm: ORIGIN },
    framePerimeter: [],
    jobStart: ORIGIN,
    approachFrom: ORIGIN,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 7,
  };
  const timing = buildGcodeTimingPlan(
    GCODE,
    {
      accelMmPerSec2: DEFAULT_DEVICE_PROFILE.accelMmPerSec2,
      junctionDeviationMm: DEFAULT_DEVICE_PROFILE.junctionDeviationMm,
      maxFeedMmPerMin: DEFAULT_DEVICE_PROFILE.maxFeed,
    },
    ORIGIN,
  );
  let streamer = step(createStreamer(GCODE, { rxBufferBytes: 512 })).state;
  for (let i = 0; i < 4; i += 1) streamer = onAck(streamer, 'ok').state;
  const state = {
    ...useLaserStore.getState(),
    ...liveCanvasStartPatch(plan, 1_000, timing),
    capabilities: grblDriver.capabilities,
    streamer,
    trustedPositionEpoch: 7,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
    probeBusy: false,
    motionOperation: null,
  };
  return status(state, report('Run', 10), 2_000);
}

function report(
  state: StatusReport['state'],
  x: number,
  subState: number | null = null,
): StatusReport {
  return {
    state,
    subState,
    mPos: { x, y: 0, z: 0 },
    wPos: { x, y: 0, z: 0 },
    feed: 600,
    spindle: 100,
    wco: null,
  };
}

function status(state: LaserState, next: StatusReport, now: number): LaserState {
  return {
    ...state,
    ...liveCanvasStatusPatch(state, next, state.streamer, now),
    statusReport: next,
  };
}

function remaining(state: LaserState, now: number): number {
  const timing = state.liveCanvasRun?.timing;
  if (timing === undefined) throw new Error('Expected timing.');
  const display = describeLiveJobTiming(timing, now);
  if (!('remainingSeconds' in display)) throw new Error('Expected numeric timing.');
  return display.remainingSeconds;
}

function pauseSender(state: LaserState): LaserState {
  if (state.streamer === null) throw new Error('Expected streamer.');
  return { ...state, streamer: pause(state.streamer) };
}

afterEach(() => vi.useRealTimers());

describe('pause countdown follows physical execution', () => {
  it('keeps route and countdown moving through a paused sender and Hold:1, then freezes at Hold:0', () => {
    const requested = pauseSender(initialState());
    const draining = status(requested, report('Run', 60), 7_000);
    expect(draining.liveCanvasRun?.lifecycle).toBe('running');
    expect(draining.liveCanvasRun?.route.confirmedRouteMm).toBeCloseTo(60);
    expect(remaining(draining, 7_000)).toBeLessThan(remaining(requested, 2_000) - 4);

    const decelerating = status(draining, report('Hold', 62, 1), 7_200);
    expect(decelerating.liveCanvasRun?.route.confirmedRouteMm).toBeCloseTo(62);
    expect(decelerating.liveCanvasRun?.timing?.kind).toBe('running');
    expect(remaining(decelerating, 7_200)).toBeCloseTo(remaining(draining, 7_000) - 0.2);

    const held = status(decelerating, report('Hold', 63, 0), 7_400);
    expect(held.liveCanvasRun?.timing?.kind).toBe('paused');
    expect(remaining(held, 70_000)).toBe(remaining(held, 7_400));
  });

  it('keeps a parking transition active until a settled Door report', () => {
    const requested = pauseSender(initialState());
    const parking = status(requested, report('Door', 10, 2), 3_000);
    expect(parking.liveCanvasRun?.timing?.kind).toBe('running');
    const held = status(parking, report('Door', 10, 1), 4_000);
    expect(held.liveCanvasRun?.timing?.kind).toBe('paused');
    const restoring = status(held, report('Door', 10, 3), 10_000);
    expect(remaining(restoring, 10_000)).toBe(remaining(held, 4_000));
    const resumed = status(restoring, report('Run', 20), 11_000);
    expect(resumed.liveCanvasRun?.timing?.kind).toBe('running');
  });

  it('requires explicit GRBL settled-hold evidence while preserving Smoothie hold reports', () => {
    const requested = pauseSender(initialState());
    expect(status(requested, report('Hold', 10), 3_000).liveCanvasRun?.timing?.kind).toBe(
      'running',
    );
    const smoothie = { ...requested, capabilities: smoothiewareDriver.capabilities };
    expect(status(smoothie, report('Hold', 10), 3_000).liveCanvasRun?.timing?.kind).toBe('paused');
  });

  it('freezes a realtime drained tail at fresh Idle without treating pending accepts as drain proof', () => {
    const requested = pauseSender(initialState());
    expect(status(requested, report('Idle', 10), 3_000).liveCanvasRun?.timing?.kind).toBe(
      'running',
    );
    if (requested.streamer === null) throw new Error('Expected streamer.');
    const drained = { ...requested, streamer: onAck(requested.streamer, 'ok').state };
    const held = status(drained, report('Idle', 200), 23_000);
    expect(held.liveCanvasRun?.timing?.kind).toBe('paused');
  });

  it('keeps a stream-only Marlin Pause and Idle-shaped M114 from claiming a physical hold', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    let state: LaserState = {
      ...initialState(),
      capabilities: marlinDriver.capabilities,
      pushSystemNotice: vi.fn(),
    };
    const safeWrite = vi.fn(async () => undefined);
    await runConfirmedPauseJob({
      get: () => state,
      set: (value) => {
        state = { ...state, ...(typeof value === 'function' ? value(state) : value) };
      },
      refs: { driver: marlinDriver } as Parameters<typeof runConfirmedPauseJob>[0]['refs'],
      safeWrite,
      driver: () => marlinDriver,
      failDarkStop: vi.fn(async () => undefined),
    });
    expect(state.streamer?.status).toBe('paused');
    expect(state.liveCanvasRun?.timing?.kind).toBe('running');
    if (state.streamer === null) throw new Error('Expected streamer.');
    const accepted = { ...state, streamer: onAck(state.streamer, 'ok').state };
    const projectedDestination = status(accepted, report('Idle', 200), 7_000);
    expect(projectedDestination.liveCanvasRun?.timing?.kind).toBe('running');
    expect(remaining(projectedDestination, 7_000)).toBeCloseTo(remaining(state, 2_000) - 5);
    expect(safeWrite).not.toHaveBeenCalled();
  });
});
