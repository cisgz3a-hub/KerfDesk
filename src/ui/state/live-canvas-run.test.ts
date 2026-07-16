import { describe, expect, it } from 'vitest';
import {
  createStreamer,
  onAck,
  step,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { INITIAL_ROUTE_RECONCILIATION } from '../../core/job/live-route-reconciliation';
import { fingerprintGcode } from '../../core/recovery';
import { startLiveCanvasRun, type CanvasMotionPlan } from './canvas-motion-plan';
import { liveCanvasLifecyclePatch, liveCanvasStatusPatch } from './live-canvas-run';
import type { LaserState } from './laser-store';

const gcode = 'G21\nG90\nM3 S0\nG0 X0 Y0\nG1 X10 S500';

function plan(capability: CanvasMotionPlan['capability'] = 'realtime'): CanvasMotionPlan {
  const manifest = buildMotionManifest(gcode, { machineKind: 'laser' });
  return {
    manifest,
    fingerprint: fingerprintGcode(gcode),
    retentionKey: 'run-a',
    machineKind: 'laser',
    device: DEFAULT_DEVICE_PROFILE,
    coordinateFrame: { kind: 'machine', workOffsetMm: { x: 0, y: 0, z: 0 } },
    framePerimeter: [],
    jobStart: { x: 0, y: 400 },
    approachFrom: { x: 0, y: 400 },
    capability,
    unavailableReason: capability === 'realtime' ? null : 'Live position unavailable.',
    resumed: false,
    positionEpoch: 7,
  };
}

function state(canvasPlan = plan()): LaserState {
  return {
    liveCanvasRun: startLiveCanvasRun(canvasPlan),
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
    trustedPositionEpoch: 7,
    probeBusy: false,
    motionOperation: null,
  } as LaserState;
}

function report(x: number, controllerState: StatusReport['state'] = 'Run'): StatusReport {
  return {
    state: controllerState,
    subState: null,
    mPos: { x, y: 0, z: 0 },
    wPos: { x, y: 0, z: 0 },
    feed: 1000,
    spindle: 500,
    wco: null,
  };
}

function acceptedStreamer(): StreamerState {
  let streamer = step(createStreamer(gcode, { rxBufferBytes: 512 })).state;
  while (streamer.completed < streamer.total) streamer = onAck(streamer, 'ok').state;
  return streamer;
}

describe('live canvas status reconciliation', () => {
  it('does not move the confirmed trail when only queue/ack state advances', () => {
    const current = state();
    const patch = liveCanvasStatusPatch(current, report(0), acceptedStreamer());
    expect(patch.liveCanvasRun?.route.confirmedRouteMm).toBe(0);
  });

  it('advances from controller position and freezes while paused', () => {
    const current = state();
    const advanced = liveCanvasStatusPatch(current, report(5), acceptedStreamer()).liveCanvasRun;
    expect(advanced?.route.confirmedRouteMm).toBeCloseTo(5);
    if (advanced == null) throw new Error('Expected a live canvas run patch.');
    const pausedStreamer = { ...acceptedStreamer(), status: 'paused' as const };
    const paused = liveCanvasStatusPatch(
      { ...current, liveCanvasRun: advanced },
      report(8, 'Hold'),
      pausedStreamer,
    ).liveCanvasRun;
    expect(paused?.lifecycle).toBe('paused');
    expect(paused?.route.confirmedRouteMm).toBeCloseTo(5);
    expect(paused?.reportedHead).toEqual(advanced.reportedHead);
  });

  it('keeps the displayed head at the last reconciled point for an off-route sample', () => {
    const current = state();
    const advanced = liveCanvasStatusPatch(current, report(5), acceptedStreamer()).liveCanvasRun;
    if (advanced == null) throw new Error('Expected a live canvas run patch.');

    const outlier = liveCanvasStatusPatch(
      { ...current, liveCanvasRun: advanced },
      report(500),
      acceptedStreamer(),
    ).liveCanvasRun;

    expect(outlier?.route.uncertain).toBe(true);
    expect(outlier?.reportedHead).toEqual(advanced.reportedHead);
    expect(outlier?.accuracyReason).toContain('Route match uncertain');
  });

  it('confirms the full Marlin route only after done plus Idle', () => {
    const current = state(plan('settle-only'));
    const before = liveCanvasStatusPatch(current, report(10), acceptedStreamer()).liveCanvasRun;
    expect(before?.route).toEqual(INITIAL_ROUTE_RECONCILIATION);
    const done = { ...acceptedStreamer(), status: 'done' as const };
    const finished = liveCanvasStatusPatch(current, report(10, 'Idle'), done).liveCanvasRun;
    expect(finished?.lifecycle).toBe('finished');
    expect(finished?.route.confirmedRouteMm).toBe(finished?.plan.manifest.totalRouteMm);
  });

  it('captures the controller feed rate, normalizing inch reports to mm/min', () => {
    const current = state();
    const mm = liveCanvasStatusPatch(current, report(5), acceptedStreamer()).liveCanvasRun;
    expect(mm?.reportedFeedMmPerMin).toBe(1000);

    const inchState = { ...current, controllerSettings: { reportInches: true } } as LaserState;
    const inch = liveCanvasStatusPatch(
      inchState,
      { ...report(5), feed: 10 },
      acceptedStreamer(),
    ).liveCanvasRun;
    expect(inch?.reportedFeedMmPerMin).toBeCloseTo(254);

    const noFeed = liveCanvasStatusPatch(
      current,
      { ...report(5), feed: null },
      acceptedStreamer(),
    ).liveCanvasRun;
    expect(noFeed?.reportedFeedMmPerMin).toBeNull();
  });

  it('preserves the last confirmed prefix when a run stops or errors', () => {
    const current = state();
    const advanced = liveCanvasStatusPatch(current, report(5), acceptedStreamer()).liveCanvasRun;
    if (advanced == null) throw new Error('Expected a live canvas run patch.');

    for (const lifecycle of ['stopped', 'errored'] as const) {
      const retained = liveCanvasLifecyclePatch(
        { ...current, liveCanvasRun: advanced },
        lifecycle,
      ).liveCanvasRun;
      expect(retained?.lifecycle).toBe(lifecycle);
      expect(retained?.route.confirmedRouteMm).toBeCloseTo(5);
    }
  });
});
