import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStreamer,
  onAck,
  step,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildGcodeTimingPlan } from '../../core/gcode-time';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import type { CanvasMotionPlan, LiveCanvasLifecycle, LiveCanvasRun } from './canvas-motion-plan';
import { buildPortClosePatch } from './laser-store-helpers';
import {
  liveCanvasLifecyclePatch,
  liveCanvasStartPatch,
  liveCanvasStatusPatch,
} from './live-canvas-run';
import { describeLiveJobTiming, type LiveJobTiming } from './live-job-timing';
import { useLaserStore, type LaserState } from './laser-store';

const GCODE = [
  'G21',
  'G90',
  'M3 S0',
  'G0 X0 Y0',
  'G1 X10 F600 S100',
  'G1 X20 F600 S100',
  'G1 X30 F600 S100',
  'M5',
].join('\n');

const TIMING_LIMITS = {
  accelMmPerSec2: DEFAULT_DEVICE_PROFILE.accelMmPerSec2,
  junctionDeviationMm: DEFAULT_DEVICE_PROFILE.junctionDeviationMm,
  maxFeedMmPerMin: DEFAULT_DEVICE_PROFILE.maxFeed,
};

const PAUSE_CASES: ReadonlyArray<{
  readonly name: string;
  readonly controllerState: 'Hold' | 'Tool';
  readonly streamStatus: 'paused' | 'tool-change';
}> = [
  { name: 'Hold', controllerState: 'Hold', streamStatus: 'paused' },
  { name: 'tool change', controllerState: 'Tool', streamStatus: 'tool-change' },
];

const TERMINAL_LIFECYCLES: ReadonlyArray<LiveCanvasLifecycle> = [
  'stopped',
  'disconnected',
  'errored',
  'finished',
];

const ACTIVE_LIFECYCLES: ReadonlyArray<Exclude<LiveCanvasLifecycle, 'finished'>> = [
  'running',
  'paused',
  'tool-change',
];

function canvasPlan(): CanvasMotionPlan {
  const manifest = buildMotionManifest(GCODE, {
    machineKind: 'laser',
    initialPosition: { x: 0, y: 0, z: 0 },
  });
  return {
    manifest,
    fingerprint: fingerprintGcode(GCODE),
    retentionKey: 'countdown-lifecycle',
    machineKind: 'laser',
    device: DEFAULT_DEVICE_PROFILE,
    coordinateFrame: { kind: 'machine', workOffsetMm: { x: 0, y: 0, z: 0 } },
    framePerimeter: [],
    jobStart: { x: 0, y: 0 },
    approachFrom: { x: 0, y: 0 },
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 7,
  };
}

function timingPlan() {
  return buildGcodeTimingPlan(GCODE, TIMING_LIMITS, { x: 0, y: 0, z: 0 });
}

function startedState(): LaserState {
  const liveCanvasRun = liveCanvasStartPatch(canvasPlan(), 0, timingPlan()).liveCanvasRun;
  if (liveCanvasRun === undefined || liveCanvasRun === null) {
    throw new Error('Expected a live canvas run.');
  }
  return {
    ...useLaserStore.getState(),
    liveCanvasRun,
    trustedPositionEpoch: 7,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
    probeBusy: false,
    motionOperation: null,
  };
}

function report(x: number, state: StatusReport['state'] = 'Run'): StatusReport {
  return {
    state,
    subState: null,
    mPos: { x, y: 0, z: 0 },
    wPos: { x, y: 0, z: 0 },
    feed: 600,
    spindle: 100,
    wco: null,
  };
}

function streamingAfterAcks(count: number): StreamerState {
  let streamer = step(createStreamer(GCODE, { rxBufferBytes: 512 })).state;
  for (let index = 0; index < count; index += 1) {
    streamer = onAck(streamer, 'ok').state;
  }
  if (streamer.status !== 'streaming') {
    throw new Error(`Expected streaming state after ${count} acknowledgements.`);
  }
  return streamer;
}

function acknowledgedStreamer(): StreamerState {
  let streamer = step(createStreamer(GCODE, { rxBufferBytes: 512 })).state;
  while (streamer.status === 'streaming') streamer = onAck(streamer, 'ok').state;
  if (streamer.status !== 'done') throw new Error('Expected fully acknowledged stream.');
  return streamer;
}

type RunningTiming = Extract<LiveJobTiming, { readonly kind: 'running' }>;

function requireRunningTiming(
  run: LiveCanvasRun | null | undefined,
): asserts run is LiveCanvasRun & { readonly timing: RunningTiming } {
  if (run === undefined || run === null || run.timing?.kind !== 'running') {
    throw new Error('Expected running timing.');
  }
}

function requireCanvasRun(run: LiveCanvasRun | null | undefined): asserts run is LiveCanvasRun {
  if (run === undefined || run === null) throw new Error('Expected a live canvas run.');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('live countdown lifecycle integration', () => {
  it('keeps estimating through pre-acceptance Idle but accepts trustworthy Run proof', () => {
    const current = startedState();
    const streamer = streamingAfterAcks(0);

    const idleBeforeAcceptance = liveCanvasStatusPatch(
      current,
      report(0, 'Idle'),
      streamer,
      10_000,
    ).liveCanvasRun;
    expect(idleBeforeAcceptance?.timing?.kind).toBe('estimating');

    const controllerRunProof = liveCanvasStatusPatch(
      current,
      report(0, 'Run'),
      streamer,
      10_000,
    ).liveCanvasRun;
    expect(controllerRunProof?.timing?.kind).toBe('running');
  });

  it('does not treat acknowledgement advancement as time progress or pacing evidence', () => {
    const current = startedState();
    const initial = liveCanvasStatusPatch(
      current,
      report(0),
      streamingAfterAcks(1),
      1_000,
    ).liveCanvasRun;
    requireRunningTiming(initial);

    const acknowledgedOnly = liveCanvasStatusPatch(
      { ...current, liveCanvasRun: initial },
      report(0),
      streamingAfterAcks(5),
      11_000,
    ).liveCanvasRun;
    requireRunningTiming(acknowledgedOnly);
    expect(acknowledgedOnly.route.confirmedRouteMm).toBe(0);
    expect(acknowledgedOnly.timing.motionPace).toBe(1);
    expect(acknowledgedOnly.timing.lastTrustedSample?.routeMm).toBe(0);

    const wrongSession = liveCanvasStatusPatch(
      { ...current, liveCanvasRun: acknowledgedOnly, trustedPositionEpoch: 8 },
      report(20),
      streamingAfterAcks(7),
      21_000,
    ).liveCanvasRun;
    requireRunningTiming(wrongSession);
    expect(wrongSession.route.confirmedRouteMm).toBe(0);
    expect(wrongSession.timing.motionPace).toBe(1);
    expect(wrongSession.timing.lastTrustedSample?.routeMm).toBe(0);

    const routeConfirmed = liveCanvasStatusPatch(
      { ...current, liveCanvasRun: acknowledgedOnly },
      report(20),
      streamingAfterAcks(7),
      21_000,
    ).liveCanvasRun;
    requireRunningTiming(routeConfirmed);
    expect(routeConfirmed.route.confirmedRouteMm).toBeCloseTo(20);
    expect(routeConfirmed.timing.lastTrustedSample?.routeMm).toBeCloseTo(20);
    expect(routeConfirmed.timing.motionPace).toBeGreaterThan(1);
  });

  it('keeps numeric route correction after all lines are acknowledged while the controller runs', () => {
    const current = startedState();
    const running = liveCanvasStatusPatch(
      current,
      report(0),
      streamingAfterAcks(1),
      1_000,
    ).liveCanvasRun;
    requireRunningTiming(running);

    const acknowledgedButExecuting = liveCanvasStatusPatch(
      { ...current, liveCanvasRun: running },
      report(20),
      acknowledgedStreamer(),
      5_000,
    ).liveCanvasRun;
    requireRunningTiming(acknowledgedButExecuting);

    expect(acknowledgedButExecuting.lifecycle).toBe('running');
    expect(acknowledgedButExecuting.route.confirmedRouteMm).toBeCloseTo(20);
    expect(describeLiveJobTiming(acknowledgedButExecuting.timing, 5_000)).toMatchObject({
      kind: 'running',
    });
  });

  it('resumes a drained paused stream from a fresh controller Run report', () => {
    const current = startedState();
    const pausedPatch = liveCanvasLifecyclePatch(current, 'paused', 2_000);
    const paused = { ...current, ...pausedPatch };

    expect(paused.liveCanvasRun?.timing?.kind).toBe('paused');

    const resumed = liveCanvasStatusPatch(
      paused,
      report(5, 'Run'),
      acknowledgedStreamer(),
      3_000,
    ).liveCanvasRun;

    expect(resumed?.lifecycle).toBe('running');
    expect(resumed?.timing?.kind).toBe('running');
  });

  it('rejects the first pendant-owned status frame as route and pacing evidence', () => {
    const current = startedState();
    const running = liveCanvasStatusPatch(
      current,
      report(0),
      streamingAfterAcks(1),
      1_000,
    ).liveCanvasRun;
    requireRunningTiming(running);

    const pendantOwned = liveCanvasStatusPatch(
      { ...current, liveCanvasRun: running, mpgActive: false },
      { ...report(20), mpgActive: true },
      streamingAfterAcks(7),
      21_000,
    ).liveCanvasRun;
    requireRunningTiming(pendantOwned);

    expect(pendantOwned.route.confirmedRouteMm).toBe(0);
    expect(pendantOwned.timing.motionPace).toBe(1);
    expect(pendantOwned.timing.lastTrustedSample).toEqual(running.timing.lastTrustedSample);
  });

  it.each(PAUSE_CASES)(
    'freezes remaining time throughout $name',
    ({ controllerState, streamStatus }) => {
      const current = startedState();
      const running = liveCanvasStatusPatch(
        current,
        report(5),
        streamingAfterAcks(5),
        1_000,
      ).liveCanvasRun;
      requireCanvasRun(running);
      const heldStreamer = { ...streamingAfterAcks(5), status: streamStatus };
      const held = liveCanvasStatusPatch(
        { ...current, liveCanvasRun: running },
        report(8, controllerState),
        heldStreamer,
        2_000,
      ).liveCanvasRun;
      if (held?.timing === undefined) throw new Error('Expected frozen timing.');

      const atHold = describeLiveJobTiming(held.timing, 2_000);
      const muchLater = describeLiveJobTiming(held.timing, 122_000);
      expect(held.lifecycle).toBe(streamStatus === 'tool-change' ? 'tool-change' : 'paused');
      expect(atHold.kind).toBe('paused');
      expect(muchLater).toEqual(atHold);
    },
  );

  it('makes a port-close countdown unavailable and never resumes it in a replacement session', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const current = {
      ...startedState(),
      streamer: streamingAfterAcks(5),
    };
    const disconnected = { ...current, ...buildPortClosePatch(current) };
    if (disconnected.liveCanvasRun?.timing === undefined) {
      throw new Error('Expected disconnected timing state.');
    }

    expect(disconnected.controllerSessionEpoch).toBe(current.controllerSessionEpoch + 1);
    expect(disconnected.liveCanvasRun.lifecycle).toBe('disconnected');
    expect(disconnected.liveCanvasRun.endedAtMs).toBe(5_000);
    expect(describeLiveJobTiming(disconnected.liveCanvasRun.timing, 90_000)).toEqual({
      kind: 'disconnected',
    });

    vi.setSystemTime(90_000);
    const replacementSession = {
      ...disconnected,
      controllerSessionEpoch: disconnected.controllerSessionEpoch + 1,
      ...liveCanvasLifecyclePatch(disconnected, 'running', 90_000),
    };
    expect(replacementSession.liveCanvasRun?.endedAtMs).toBe(5_000);
    expect(replacementSession.liveCanvasRun?.timing?.kind).toBe('disconnected');

    const repeatedClose = {
      ...replacementSession,
      ...buildPortClosePatch(replacementSession),
    };
    expect(repeatedClose.liveCanvasRun?.endedAtMs).toBe(5_000);
    expect(repeatedClose.liveCanvasRun?.timing?.kind).toBe('disconnected');
  });

  it.each(TERMINAL_LIFECYCLES)(
    'does not revive a %s run through later active lifecycle patches',
    (terminalLifecycle) => {
      const current = startedState();
      const liveCanvasRun = current.liveCanvasRun;
      if (liveCanvasRun === undefined || liveCanvasRun === null) {
        throw new Error('Expected a live canvas run.');
      }
      const terminalRun: LiveCanvasRun = {
        ...liveCanvasRun,
        lifecycle: terminalLifecycle,
        endedAtMs: 5_000,
      };

      for (const activeLifecycle of ACTIVE_LIFECYCLES) {
        expect(
          liveCanvasLifecyclePatch(
            { ...current, liveCanvasRun: terminalRun },
            activeLifecycle,
            90_000,
          ),
        ).toEqual({});
      }
    },
  );
});
