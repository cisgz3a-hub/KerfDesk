import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toSceneCoords, type Origin } from '../../core/devices';
import type { CncGroup, Job } from '../../core/job';
import { emitCncJobWithPassSpans } from '../../core/output';
import {
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  type Project,
} from '../../core/scene';
import { emitPreparedGcode, type PreparedOutput } from '../../io/gcode';
import {
  buildCanvasMotionPlan,
  buildCanvasMarkerPlan,
  canvasPlanRetentionKey,
  mapControllerPointToScene,
  rebuildCanvasPlanForGcode,
  reportedWorkPositionMm,
} from './canvas-motion-plan';

const JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'red',
      color: '#ff0000',
      power: 50,
      speed: 1000,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 20 },
            { x: 30, y: 20 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

describe('canvasPlanRetentionKey', () => {
  it('does not serialize the same immutable project more than once per option set', () => {
    const source = createProject();
    let sceneReads = 0;
    const project = new Proxy(source, {
      get(target, property, receiver) {
        if (property === 'scene') sceneReads += 1;
        return Reflect.get(target, property, receiver);
      },
    }) as Project;
    const placement = { startFrom: 'absolute' as const, anchor: 'front-left' as const };
    const first = canvasPlanRetentionKey(project, DEFAULT_OUTPUT_SCOPE, placement);
    const second = canvasPlanRetentionKey(project, DEFAULT_OUTPUT_SCOPE, placement);
    expect(second).toBe(first);
    expect(sceneReads).toBe(1);
    canvasPlanRetentionKey(project, DEFAULT_OUTPUT_SCOPE, placement, null);
    expect(sceneReads).toBe(2);
  });
});

function prepared(controllerKind: 'grbl-v1.1' | 'marlin' | 'ruida' = 'grbl-v1.1') {
  const project = createProject({
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind,
    origin: 'rear-left',
  });
  return {
    ok: true,
    project,
    job: JOB,
    jobOriginOffset: { x: 0, y: 0 },
  } satisfies Extract<PreparedOutput, { readonly ok: true }>;
}

const machine = {
  statusReport: {
    state: 'Idle' as const,
    subState: null,
    mPos: { x: 2, y: 1, z: 0 },
    wPos: { x: 2, y: 1, z: 0 },
    feed: 0,
    spindle: 0,
    wco: null,
  },
  alarmCode: null,
  hasActiveStreamer: false,
  workOriginActive: false,
  wcoCache: null,
  trustedPositionEpoch: 4,
};

function twoPassCncPrepared() {
  const cncGroup: CncGroup = {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'engrave',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes: [
      {
        kind: 'contour',
        zMm: -1,
        polyline: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        closed: false,
      },
      {
        kind: 'contour',
        zMm: -2,
        polyline: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        closed: false,
      },
    ],
  };
  const job: Job = { groups: [cncGroup] };
  const project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
  return { ok: true, project, job, jobOriginOffset: { x: 0, y: 0 } } satisfies Extract<
    PreparedOutput,
    { readonly ok: true }
  >;
}

describe('CanvasMotionPlan', () => {
  it('normalizes MPos/WCO inch reports into work millimetres', () => {
    expect(
      reportedWorkPositionMm(
        {
          statusReport: { ...machine.statusReport, wPos: null },
          workOriginActive: true,
          wcoCache: { x: 1, y: 0.5, z: 0 },
        },
        true,
      ),
    ).toEqual({ x: 25.4, y: 12.7, z: 0 });
  });

  it('uses the WCO from the same status frame before an older cached offset', () => {
    expect(
      reportedWorkPositionMm(
        {
          statusReport: {
            ...machine.statusReport,
            mPos: { x: 12, y: 9, z: 0 },
            wPos: null,
            wco: { x: 2, y: 4, z: 0 },
          },
          workOriginActive: true,
          wcoCache: { x: 100, y: 80, z: 0 },
        },
        false,
      ),
    ).toEqual({ x: 10, y: 5, z: 0 });
  });

  it.each<Origin>(['front-left', 'front-right', 'rear-left', 'rear-right', 'center'])(
    'maps controller coordinates through the %s device origin',
    (origin) => {
      const device = { ...DEFAULT_DEVICE_PROFILE, origin };
      const point = { x: 25, y: 30, z: 0 };
      expect(
        mapControllerPointToScene(point, {
          device,
          coordinateFrame: {
            kind: 'machine',
            workOffsetMm: { x: 5, y: 7, z: 0 },
          },
        }),
      ).toEqual(toSceneCoords({ x: 30, y: 37 }, device));
    },
  );

  it('matches full, settle-only, and file-only controller capabilities', () => {
    const gcode = 'G21\nG90\nM3 S0\nG0 X10 Y20\nG1 X30 S500';
    const grbl = buildCanvasMotionPlan({
      gcode,
      prepared: prepared(),
      machine,
      statusQuery: 'realtime-report',
    });
    const marlin = buildCanvasMotionPlan({
      gcode,
      prepared: prepared('marlin'),
      machine,
      statusQuery: 'queued-poll',
    });
    const ruida = buildCanvasMotionPlan({
      gcode,
      prepared: prepared('ruida'),
      machine,
      statusQuery: 'none',
    });
    expect(grbl.capability).toBe('realtime');
    expect(grbl.framePerimeter[0]).toEqual({ x: 10, y: 20 });
    expect(marlin.capability).toBe('settle-only');
    expect(ruida.capability).toBe('file-only');
    expect(ruida.framePerimeter).toEqual([]);
    expect(ruida.jobStart).toEqual({ x: 10, y: 20 });
  });

  it('derives idle markers from the prepared job without constructing a route manifest', () => {
    const full = buildCanvasMotionPlan({
      gcode: 'G21\nG90\nM3 S0\nG0 X10 Y20\nG1 X30 S500',
      prepared: prepared(),
      machine,
      statusQuery: 'realtime-report',
    });
    const markers = buildCanvasMarkerPlan({
      prepared: prepared(),
      machine,
      statusQuery: 'realtime-report',
      retentionKey: 'idle-markers',
    });
    expect(markers.jobStart).toEqual(full.jobStart);
    expect(markers.framePerimeter).toEqual(full.framePerimeter);
    expect(markers.coordinateFrame).toEqual(full.coordinateFrame);
    expect(markers.manifest.blocks).toEqual([]);
  });

  it('labels verified-origin plans as relative and keeps the marker artwork-relative', () => {
    const plan = buildCanvasMotionPlan({
      gcode: 'G21\nG90\nM3 S0\nG0 X0 Y0\nG1 X20 S500',
      prepared: { ...prepared(), jobOriginOffset: { x: -10, y: -20 } },
      machine: { ...machine, workOriginActive: true, wcoCache: { x: 100, y: 80, z: 0 } },
      statusQuery: 'realtime-report',
      jobOrigin: { startFrom: 'verified-origin', anchor: 'front-left' },
    });
    expect(plan.coordinateFrame.kind).toBe('relative');
    expect(plan.jobStart).toEqual({ x: 10, y: 20 });
  });

  it('attaches CNC pass spans for the plain strategy emission and drops them on rebuild', () => {
    const { project, job } = twoPassCncPrepared();
    const emission = emitCncJobWithPassSpans(job, project.device);
    const plan = buildCanvasMotionPlan({
      gcode: emission.gcode,
      prepared: { ok: true, project, job, jobOriginOffset: { x: 0, y: 0 } },
      machine,
      statusQuery: 'realtime-report',
    });
    expect(plan.machineKind).toBe('cnc');
    expect(plan.cncPassSpans?.map(({ passIndex }) => passIndex)).toEqual([0, 1]);

    const resumed = rebuildCanvasPlanForGcode(plan, 'G21\nG90\nG1 Z-2.000 F300');
    expect(resumed.cncPassSpans).toBeUndefined();
  });

  it('keeps CNC pass spans when a current-position start adds park lines', () => {
    const preparedCnc = twoPassCncPrepared();
    // #226 threads finishPosition into a current-position job's emission, so
    // the started program's park lines differ from an option-less re-emission.
    const jobOrigin = {
      startFrom: 'current-position',
      anchor: 'front-left',
      currentPosition: { x: 25, y: 40 },
    } as const;
    const { gcode } = emitPreparedGcode(preparedCnc, { jobOrigin });
    const plan = buildCanvasMotionPlan({
      gcode,
      prepared: preparedCnc,
      machine,
      statusQuery: 'realtime-report',
      jobOrigin,
    });
    expect(plan.cncPassSpans?.map(({ passIndex }) => passIndex)).toEqual([0, 1]);
  });

  it('rebuilds a resumed approach from the controller position captured for that run', () => {
    const original = buildCanvasMotionPlan({
      gcode: 'G21\nG90\nM3 S0\nG0 X10 Y20\nG1 X30 S500',
      prepared: prepared(),
      machine,
      statusQuery: 'realtime-report',
    });
    const resumed = rebuildCanvasPlanForGcode(
      original,
      'G21\nG90\nM3 S0\nG0 X20 Y20\nG1 X30 S500',
      { x: 18, y: 19, z: 0 },
    );

    expect(resumed.resumed).toBe(true);
    expect(resumed.approachFrom).toEqual({ x: 18, y: 19 });
    expect(resumed.jobStart).toEqual({ x: 20, y: 20 });
  });
});
