import { describe, expect, it } from 'vitest';
import { toMachineCoords } from '../../core/devices';
import type { FillGroup, JobOriginPlacement } from '../../core/job';
import { buildCanvasStartEditingData } from './canvas-start-editing-data';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import {
  reusableStartPoints,
  selectCanvasStart,
  startEditingContext,
} from '../workspace/canvas-start-editing';
import {
  buildCanvasMarkerPlan,
  mapControllerPointToScene,
  type CanvasMotionPlan,
} from './canvas-motion-plan';
import { stockNativeEvidence } from './native-bed-frame.test-support';

function rectangle(
  id: string,
  color: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX, minY, maxX, maxY },
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: minX, y: minY },
              { x: maxX, y: minY },
              { x: maxX, y: maxY },
              { x: minX, y: maxY },
              { x: minX, y: minY },
            ],
          },
        ],
      },
    ],
  };
}

function twoOperations(): Project {
  const base = createProject();
  return {
    ...base,
    device: {
      ...base.device,
      origin: 'rear-left',
      homing: { ...base.device.homing, enabled: true },
    },
    startPoints: { frame: { edge: 2, fraction: 0.25 } },
    scene: {
      layers: [
        { ...createLayer({ id: 'first', color: '#000000' }), power: 50 },
        { ...createLayer({ id: 'later', color: '#ff0000' }), power: 50 },
      ],
      objects: [
        rectangle('first', '#000000', 10, 20, 50, 60),
        rectangle('later', '#ff0000', 100, 120, 130, 160),
      ],
    },
  };
}

function idlePlan(project: Project, jobOrigin: JobOriginPlacement) {
  const prepared = prepareOutput(project, { jobOrigin });
  if (!prepared.ok) throw new Error('Expected two prepared operations');
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
  return { prepared, plan, displayed };
}

function expectMappedFrame(plan: CanvasMotionPlan, relative: boolean): void {
  expect(plan.coordinateFrame.kind).toBe(relative ? 'relative' : 'machine');
  if (plan.coordinateFrame.kind === 'machine') {
    expect(plan.coordinateFrame.nativeToBedOffsetMm).not.toEqual({ x: 0, y: 0 });
  } else {
    expect(plan.coordinateFrame.jobOriginOffset).not.toEqual({ x: 0, y: 0 });
  }
}

describe('idle marker editing metadata crossing the worker boundary', () => {
  it('uses device scan calibration when deciding whether a preceding fill locks job-start editing', () => {
    const project = twoOperations();
    const prepared = prepareOutput(project);
    if (!prepared.ok) throw new Error('Expected prepared operations');
    const fill: FillGroup = {
      kind: 'fill',
      layerId: 'fill',
      color: '#000',
      power: 50,
      passes: 1,
      speed: 1000,
      airAssist: false,
      overscanMm: 2,
      fillRunwayPolicy: 'feed-matched-every-sweep',
      segments: [
        {
          closed: false,
          reverse: true,
          polyline: [
            { x: 10.0002, y: 20 },
            { x: 10.0001, y: 20 },
          ],
        },
      ],
    };
    const job = { groups: [fill, ...prepared.job.groups] };
    const blank = buildCanvasStartEditingData({ ...prepared, job });
    expect(blank.jobReason).toBeNull();
    expect(blank.job.groups[0]?.kind).toBe('cut');
    const calibrated = buildCanvasStartEditingData({
      ...prepared,
      job,
      project: {
        ...project,
        device: {
          ...project.device,
          scanningOffsets: [{ speedMmPerMin: 1000, offsetMm: 0.00065 }],
        },
      },
    });
    expect(calibrated.jobReason).toContain('generated scan order');
    expect(calibrated.job.groups).toEqual([]);
  });

  it.each([false, true])(
    'restores edits, executable start and full-job defaults after structuredClone (relative=%s)',
    (relative) => {
      const project = twoOperations();
      const jobOrigin: JobOriginPlacement = relative
        ? { startFrom: 'verified-origin', anchor: 'center' }
        : { startFrom: 'absolute', anchor: 'front-left' };
      const original = idlePlan(project, jobOrigin);
      expect(original.prepared.job.groups).toHaveLength(2);
      expectMappedFrame(original.plan, relative);

      // No WeakMap context survives the worker's structured clone.
      const cloned = structuredClone(original.plan);
      expect(startEditingContext(cloned)).toBeUndefined();
      const context = startEditingContext(cloned, project);
      if (context === undefined) throw new Error('Expected restored editing metadata');
      expect(context.sourceProject).toBe(project);
      expect(context.prepared.job.groups).toHaveLength(1);
      const selected = selectCanvasStart(
        'job',
        original.displayed({ x: 52, y: 40 }),
        cloned,
        context,
      );
      if (selected === null) throw new Error('Expected a selected cutting start');
      expect(selected.settings.job).toEqual({ x: 50, y: 40 });
      expect(selected.point).toEqual(original.displayed({ x: 50, y: 40 }));

      const changedProject = { ...project, startPoints: selected.settings };
      const changed = idlePlan(changedProject, jobOrigin);
      const emission = emitPreparedGcode(changed.prepared);
      if (emission.gcode === null) throw new Error('Expected emitted G-code');
      const first = buildMotionManifest(emission.gcode, { machineKind: 'laser' }).firstProcessPoint;
      if (first === null) throw new Error('Expected emitted cutting motion');
      expect(mapControllerPointToScene(first, changed.plan)).toEqual(selected.point);
      expect(changed.plan.jobStart).toEqual(selected.point);

      const changedContext = startEditingContext(structuredClone(changed.plan), changedProject);
      if (changedContext === undefined) throw new Error('Expected edited metadata');
      const defaults = reusableStartPoints(changedContext);
      expect(defaults.frame).toEqual(project.startPoints?.frame);
      expect(defaults.job?.relative).toBe(true);
      // The retained full bounds are 10..130 and 20..160. The compact first
      // operation alone would incorrectly save x=1 and y=0.5.
      expect(defaults.job?.x).toBeCloseTo(1 / 3);
      expect(defaults.job?.y).toBeCloseTo(1 / 7);
    },
  );
});
