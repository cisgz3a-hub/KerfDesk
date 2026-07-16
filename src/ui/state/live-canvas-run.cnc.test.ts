// CNC live canvas motion (ADR-216) — the same status-report pipeline the
// laser trail uses must advance a multi-pass CNC run: depth passes retrace
// the same XY route, so reconciliation has to disambiguate by Z and by the
// monotonic route frontier instead of raw position matching.

import { describe, expect, it } from 'vitest';
import {
  createStreamer,
  onAck,
  step,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import type { MotionPoint } from '../../core/job/motion-manifest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { buildCanvasMotionPlan, startLiveCanvasRun } from './canvas-motion-plan';
import { cncPassPosition } from './canvas-pass-progress';
import { liveCanvasStatusPatch } from './live-canvas-run';
import type { LaserState } from './laser-store';

const LAYER_COLOR = '#ff0000';
const TRUSTED_EPOCH = 4;

// A 60 mm straight profile-on-path line cut in two depth passes (3 mm total,
// 1.5 mm per pass) — both passes share every XY coordinate.
function cncProject(): Project {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'straight-path',
    source: 'straight.svg',
    bounds: { minX: 20, minY: 20, maxX: 80, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: LAYER_COLOR,
        polylines: [
          {
            closed: false,
            points: [
              { x: 20, y: 20 },
              { x: 80, y: 20 },
            ],
          },
        ],
      },
    ],
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [object],
      layers: [
        {
          ...createLayer({ id: 'layer-a', color: LAYER_COLOR }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'profile-on-path',
            depthMm: 3,
            depthPerPassMm: 1.5,
          },
        },
      ],
    },
  };
}

const machineSnapshot = {
  statusReport: {
    state: 'Idle' as const,
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: { x: 0, y: 0, z: 0 },
    feed: 0,
    spindle: 0,
    wco: null,
  },
  alarmCode: null,
  hasActiveStreamer: false,
  workOriginActive: false,
  wcoCache: null,
  trustedPositionEpoch: TRUSTED_EPOCH,
};

function report(position: MotionPoint): StatusReport {
  return {
    state: 'Run',
    subState: null,
    mPos: position,
    wPos: position,
    feed: 1000,
    spindle: 12000,
    wco: null,
  };
}

// Pump acks and refills together: rxBufferBytes is clamped to real GRBL
// windows (max 4096), so an ack-only loop starves once the first window
// drains and never terminates.
function fullyAckedStreamer(gcode: string): StreamerState {
  let streamer = step(createStreamer(gcode, { rxBufferBytes: 512, toolChangePause: true })).state;
  let remainingPumps = streamer.total * 2 + 16;
  while (streamer.completed < streamer.total) {
    remainingPumps -= 1;
    if (remainingPumps < 0) throw new Error('Streamer did not drain within the pump budget.');
    streamer = step(onAck(streamer, 'ok').state).state;
  }
  return streamer;
}

describe('CNC live canvas motion', () => {
  it('advances head, trail, and pass counter across depth passes of identical XY', () => {
    const prepared = prepareOutput(cncProject());
    if (!prepared.ok) throw new Error('Expected prepared CNC output.');
    const emitted = emitPreparedGcode(prepared);
    if (!emitted.preflight.ok) throw new Error('Expected valid CNC preflight.');

    const plan = buildCanvasMotionPlan({
      gcode: emitted.gcode,
      prepared,
      machine: machineSnapshot,
      statusQuery: 'realtime-report',
    });
    expect(plan.machineKind).toBe('cnc');
    expect(plan.capability).toBe('realtime');
    // Byte-identity held through the real Start emission path, so the
    // ADR-215 sidecar mapped both depth passes onto the route.
    expect(plan.cncPassSpans?.length).toBe(2);
    const spans = plan.cncPassSpans;
    if (spans === undefined) throw new Error('Expected mapped CNC pass spans.');

    const streamer = fullyAckedStreamer(emitted.gcode);
    let state = {
      liveCanvasRun: startLiveCanvasRun(plan),
      controllerSettings: null,
      wcoCache: null,
      workOriginActive: false,
      trustedPositionEpoch: TRUSTED_EPOCH,
      probeBusy: false,
      motionOperation: null,
      // Only the fields liveCanvasStatusPatch reads are populated here.
    } as LaserState;

    const seenPasses: number[] = [];
    let previousConfirmed = 0;
    for (const block of plan.manifest.blocks) {
      const settled = block.points.at(-1);
      if (settled === undefined) continue;
      const run = liveCanvasStatusPatch(state, report(settled), streamer).liveCanvasRun;
      if (run == null) throw new Error('Expected a live canvas run patch.');
      expect(run.route.uncertain).toBe(false);
      expect(run.reportedHead).toEqual(settled);
      expect(run.route.confirmedRouteMm).toBeGreaterThanOrEqual(previousConfirmed);
      previousConfirmed = run.route.confirmedRouteMm;
      const passes = cncPassPosition(spans, run.route.confirmedRouteMm);
      if (passes !== null) seenPasses.push(passes.current);
      state = { ...state, liveCanvasRun: run };
    }

    // The counter walked pass 1 → pass 2 without regressing, even though
    // every pass-2 XY coordinate also exists on pass 1.
    expect(seenPasses[0]).toBe(1);
    expect(seenPasses.at(-1)).toBe(2);
    expect([...seenPasses].sort((a, b) => a - b)).toEqual(seenPasses);
    expect(new Set(seenPasses)).toEqual(new Set([1, 2]));
    // The trail reached the second pass's route range.
    const secondSpan = spans[1];
    expect(previousConfirmed).toBeGreaterThanOrEqual(secondSpan?.routeEndMm ?? Number.NaN);
  });
});
