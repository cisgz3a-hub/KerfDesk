import { describe, expect, it } from 'vitest';
import { DEFAULT_ROTARY_SETUP, toMachineCoords, type Origin } from '../../core/devices';
import type { JobOriginPlacement } from '../../core/job';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type Vec2,
} from '../../core/scene';
import { type FrameStartPoint } from '../../core/scene/start-points';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { buildCanvasMarkerPlan, mapControllerPointToScene } from '../state/canvas-motion-plan';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import {
  reusableStartPoints,
  selectCanvasStart,
  startEditReason,
  type StartEditingContext,
} from './canvas-start-editing';

function rectangle(
  origin: Origin = 'rear-left',
  mode: 'line' | 'fill' = 'line',
  closed = true,
): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, origin, homing: { ...base.device.homing, enabled: true } },
    scene: {
      layers: [createLayer({ id: 'line', color: '#000000', mode })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'box',
          source: 'box.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 10, minY: 20, maxX: 50, maxY: 60 },
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed,
                  points: closed
                    ? [
                        { x: 10, y: 20 },
                        { x: 50, y: 20 },
                        { x: 50, y: 60 },
                        { x: 10, y: 60 },
                        { x: 10, y: 20 },
                      ]
                    : [
                        { x: 10, y: 20 },
                        { x: 50, y: 20 },
                      ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function editing(project: Project, relative: boolean) {
  const jobOrigin: JobOriginPlacement = relative
    ? { startFrom: 'verified-origin', anchor: 'center' }
    : { startFrom: 'absolute', anchor: 'front-left' };
  const prepared = prepareOutput(project, { jobOrigin });
  if (!prepared.ok) throw new Error('expected prepared rectangle');
  const plan = buildCanvasMarkerPlan({
    prepared,
    jobOrigin,
    machine: {
      ...stockNativeEvidence(project.device),
      statusReport: null,
      alarmCode: null,
      hasActiveStreamer: false,
      wcoCache: { x: 7, y: 11, z: 0 },
    },
  });
  const context: StartEditingContext = { prepared, sourceProject: project, registered: false };
  // The machine view includes WCO; the relative view stays registered to artwork.
  const displayed = (point: Vec2) => {
    const machinePoint = toMachineCoords(point, project.device);
    return mapControllerPointToScene(
      {
        x: machinePoint.x + prepared.jobOriginOffset.x,
        y: machinePoint.y + prepared.jobOriginOffset.y,
        z: 0,
      },
      plan,
    );
  };
  return { context, plan, displayed, jobOrigin };
}

const origins: ReadonlyArray<{ origin: Origin; frame: FrameStartPoint }> = [
  { origin: 'rear-left', frame: { edge: 0, fraction: 0.25 } },
  { origin: 'rear-right', frame: { edge: 0, fraction: 0.75 } },
  { origin: 'front-left', frame: { edge: 2, fraction: 0.75 } },
  { origin: 'front-right', frame: { edge: 2, fraction: 0.25 } },
  { origin: 'center', frame: { edge: 2, fraction: 0.75 } },
];

describe.each([false, true])('canvas start mapping with relative view=%s', (relative) => {
  it('keeps an open path drawn direction when source order retains a stale allow-reverse setting', () => {
    const base = rectangle('rear-left', 'line', false);
    const project: Project = {
      ...base,
      optimization: {
        ...base.optimization,
        travelPolicy: 'source-order',
        pathDirection: 'allow-reverse',
      },
    };
    const { context, plan, displayed } = editing(project, relative);
    const selected = selectCanvasStart('job', displayed({ x: 50, y: 20 }), plan, context);
    expect(selected?.settings.job).toEqual({ x: 10, y: 20 });
    expect(selected?.point).toEqual(displayed({ x: 10, y: 20 }));
    if (selected === null) throw new Error('expected cutting selection');
    const changed = editing({ ...project, startPoints: selected.settings }, relative);
    const emitted = emitPreparedGcode(changed.context.prepared);
    const manifest = buildMotionManifest(emitted.gcode, { machineKind: 'laser' });
    if (manifest.firstProcessPoint === null) throw new Error('expected emitted cutting motion');
    expect(mapControllerPointToScene(manifest.firstProcessPoint, changed.plan)).toEqual(
      selected.point,
    );
  });

  it.each(origins)(
    'snaps the frame to the actual controller edge for $origin',
    ({ origin, frame }) => {
      const project = { ...rectangle(origin), startPoints: { job: { x: 10, y: 30 } } };
      const { context, plan, displayed } = editing(project, relative);
      expect(plan.coordinateFrame.kind).toBe(relative ? 'relative' : 'machine');
      const selected = selectCanvasStart('frame', displayed({ x: 20, y: 18 }), plan, context);
      expect(selected?.settings).toEqual({ job: { x: 10, y: 30 }, frame });
      expect(selected?.point).toEqual(displayed({ x: 20, y: 20 }));
      if (selected === null) throw new Error('expected frame selection');
      const changed = editing({ ...project, startPoints: selected.settings }, relative);
      expect(changed.plan.framePerimeter[0]).toEqual(selected.point);
      expect(changed.plan.framePerimeter.at(-1)).toEqual(selected.point);
    },
  );

  it.each(origins)(
    'persists scene coordinates and emits the previewed cutting start for $origin',
    ({ origin }) => {
      const project = {
        ...rectangle(origin),
        startPoints: { frame: { edge: 1 as const, fraction: 0.5 } },
      };
      const { context, plan, displayed } = editing(project, relative);
      const selected = selectCanvasStart('job', displayed({ x: 20, y: 18 }), plan, context);
      expect(selected?.settings).toEqual({
        frame: project.startPoints.frame,
        job: { x: 20, y: 20 },
      });
      expect(selected?.point).toEqual(displayed({ x: 20, y: 20 }));
      if (selected === null) throw new Error('expected cutting selection');
      const changed = editing({ ...project, startPoints: selected.settings }, relative);
      expect(changed.plan.jobStart).toEqual(selected.point);
      const emitted = emitPreparedGcode(changed.context.prepared);
      if (emitted.gcode === null) throw new Error('expected emitted G-code');
      const manifest = buildMotionManifest(emitted.gcode, { machineKind: 'laser' });
      if (manifest.firstProcessPoint === null) throw new Error('expected emitted cutting motion');
      expect(mapControllerPointToScene(manifest.firstProcessPoint, changed.plan)).toEqual(
        selected.point,
      );
    },
  );
});

describe('reusable start preferences', () => {
  it.each(origins)(
    'normalizes scene proportions without origin flips or placement offsets for $origin',
    async ({ origin }) => {
      const project = {
        ...rectangle(origin),
        startPoints: {
          frame: { edge: 2 as const, fraction: 0.6 },
          job: { x: 20, y: 50 },
        },
      };
      expect(await reusableStartPoints(editing(project, true).context)).toEqual({
        frame: project.startPoints.frame,
        job: { x: 0.25, y: 0.75, relative: true },
      });
    },
  );

  it('keeps relative preferences unchanged and clamps absolute points to future bounds', async () => {
    const project = {
      ...rectangle(),
      startPoints: { job: { x: 0.2, y: 0.8, relative: true as const } },
    };
    expect(await reusableStartPoints(editing(project, true).context)).toEqual(project.startPoints);
    const outside = { ...project, startPoints: { job: { x: -40, y: 100 } } };
    expect(await reusableStartPoints(editing(outside, false).context)).toEqual({
      job: { x: 0, y: 1, relative: true },
    });
  });
});

describe('unsupported start editing', () => {
  it('keeps generated fill scanning fixed while still allowing a frame selection', () => {
    const { context, plan } = editing(rectangle('rear-left', 'fill'), true);
    expect(startEditReason('job', context)).toMatch(/scan order/);
    expect(selectCanvasStart('job', { x: 20, y: 20 }, plan, context)).toBeNull();
    expect(startEditReason('frame', context)).toBeNull();
    expect(selectCanvasStart('frame', { x: 20, y: 20 }, plan, context)).not.toBeNull();
  });

  it('disables both handles during registered output and rotary surface output', () => {
    const project = rectangle();
    const registered = { ...editing(project, true).context, registered: true };
    const rotary = editing(
      {
        ...project,
        device: {
          ...project.device,
          rotary: { ...DEFAULT_ROTARY_SETUP, enabled: true },
        },
      },
      true,
    ).context;
    for (const kind of ['frame', 'job'] as const) {
      expect(startEditReason(kind, registered)).toMatch(/registration/);
      expect(startEditReason(kind, rotary)).toMatch(/rotary/);
    }
  });

  it('offers no movable job start when the prepared output has no geometry', () => {
    const { context, plan } = editing(createProject(), true);
    expect(startEditReason('job', context)).toMatch(/no movable cutting start/);
    expect(selectCanvasStart('frame', { x: 20, y: 20 }, plan, context)).toBeNull();
  });
});
