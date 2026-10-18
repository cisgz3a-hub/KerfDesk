// Laser lead-in and lead-out end to end (ADR-626): off by default and
// byte-identical while off; when on, every output and every reader of the
// prepared job carries the same leads.

import { describe, expect, it } from 'vitest';
import { planRdMotion } from '../../core/controllers/ruida/rd-motion-plan';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  buildToolpath,
  estimateJobDuration,
  summarizeToolpathDistances,
  type CutGroup,
  type Job,
} from '../../core/job';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Layer,
  type LayerOperationSettings,
  type Polyline,
  type Project,
  type Vec2,
} from '../../core/scene';
import { computeFrameJobMotionBounds } from '../../core/job/job-bounds';
import { deserializeProject } from '../project/deserialize-project';
import { serializeProject } from '../project/serialize-project';
import { emitGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';

const ARC_DEVICE: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' };
const MARLIN_DEVICE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'marlin',
  maxPowerS: 255,
  gcodeDialect: { dialectId: 'marlin-inline' },
};
const SMOOTHIE_DEVICE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'smoothieware',
  maxPowerS: 1,
};
const DEVICES = [DEFAULT_DEVICE_PROFILE, ARC_DEVICE, MARLIN_DEVICE, SMOOTHIE_DEVICE];

const LEADS_ON: Partial<LayerOperationSettings> = { leadInEnabled: true, leadOutEnabled: true };

function square(min: number, max: number): Polyline {
  return {
    closed: true,
    points: [
      { x: min, y: min },
      { x: max, y: min },
      { x: max, y: max },
      { x: min, y: max },
    ],
  };
}

/** A 40 mm plate with a 10 mm square hole, on one Line operation. */
function plate(device: DeviceProfile, settings: Partial<LayerOperationSettings> = {}): Project {
  const layer: Layer = { ...createLayer({ id: 'cut', color: '#ff0000' }), ...settings };
  return {
    ...createProject(device),
    scene: {
      layers: [layer],
      objects: [
        {
          kind: 'imported-svg',
          id: 'plate',
          source: 'plate.svg',
          bounds: { minX: 20, minY: 20, maxX: 60, maxY: 60 },
          transform: IDENTITY_TRANSFORM,
          paths: [{ color: '#ff0000', polylines: [square(20, 60), square(35, 45)] }],
        },
      ],
    },
  };
}

function preparedJob(project: Project): Job {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('expected the project to prepare');
  return prepared.job;
}

function cutGroups(job: Job): CutGroup[] {
  return job.groups.filter((group): group is CutGroup => group.kind === 'cut');
}

function seek(point: Vec2): RegExp {
  return new RegExp(`^G0 X${point.x.toFixed(3)} Y${point.y.toFixed(3)}`, 'gm');
}

describe('laser leads in prepared output (ADR-626)', () => {
  it('emits byte-identical output while leads are off, set or not', () => {
    const offButSet: Partial<LayerOperationSettings> = {
      leadInEnabled: false,
      leadOutEnabled: false,
      leadStyle: 'line',
      leadLengthMm: 5,
      leadAngleDeg: 30,
      leadSide: 'inside',
    };
    for (const device of DEVICES) {
      for (const passes of [1, 3]) {
        for (const overcutMm of [undefined, 2]) {
          const extras = { passes, overcutMm };
          const base = plate(device, extras);
          const off = plate(device, { ...extras, ...offButSet });
          expect(emitGcode(off).gcode).toBe(emitGcode(base).gcode);
          expect(preparedJob(off)).toEqual(preparedJob(base));
          expect(planRdMotion(cutGroups(preparedJob(off)))).toEqual(
            planRdMotion(cutGroups(preparedJob(base))),
          );
        }
      }
    }
  });

  it('starts every pass of every contour on its lead and says so in the layer comment', () => {
    const job = preparedJob(plate(DEFAULT_DEVICE_PROFILE, { ...LEADS_ON, passes: 2 }));
    const [cut] = cutGroups(job);
    expect(cut?.segments.every((segment) => !segment.closed)).toBe(true);
    const gcode = emitGcode(plate(DEFAULT_DEVICE_PROFILE, { ...LEADS_ON, passes: 2 })).gcode;
    expect(gcode).toContain('leads in+out arc 2.000 mm at 90 deg');
    for (const segment of cut?.segments ?? []) {
      expect(gcode.match(seek(segment.polyline[0] as Vec2))).toHaveLength(2);
    }
  });

  it('carries the same leads to Marlin, Smoothieware and Ruida', () => {
    for (const device of [MARLIN_DEVICE, SMOOTHIE_DEVICE]) {
      const project = plate(device, LEADS_ON);
      const first = cutGroups(preparedJob(project))[0]?.segments[0]?.polyline[0] as Vec2;
      expect(emitGcode(project).gcode).toMatch(
        new RegExp(`X${first.x.toFixed(3)} Y${first.y.toFixed(3)}`),
      );
    }
    const withLeads = planRdMotion(cutGroups(preparedJob(plate(DEFAULT_DEVICE_PROFILE, LEADS_ON))));
    const without = planRdMotion(cutGroups(preparedJob(plate(DEFAULT_DEVICE_PROFILE))));
    const cuts = (parts: typeof without): number =>
      parts.flatMap((part) => part.steps).filter((step) => step.cut).length;
    expect(cuts(withLeads)).toBeGreaterThan(cuts(without));
  });

  it('shows the leads in Frame bounds, the preview route and the time estimate', () => {
    const device = DEFAULT_DEVICE_PROFILE;
    const leaded = preparedJob(plate(device, LEADS_ON));
    const plain = preparedJob(plate(device));
    const leadedBounds = computeFrameJobMotionBounds(leaded, device);
    const plainBounds = computeFrameJobMotionBounds(plain, device);
    if (leadedBounds === null || plainBounds === null) throw new Error('expected bounds');
    const grows =
      leadedBounds.minX < plainBounds.minX ||
      leadedBounds.minY < plainBounds.minY ||
      leadedBounds.maxX > plainBounds.maxX ||
      leadedBounds.maxY > plainBounds.maxY;
    expect(grows).toBe(true);
    const cutMm = (job: Job): number => summarizeToolpathDistances(buildToolpath(job)).cutMm;
    // Four leads of 2 mm: in and out on the plate and on the hole.
    expect(cutMm(leaded) - cutMm(plain)).toBeCloseTo(8, 1);
    expect(estimateJobDuration(leaded, device).totalSeconds).toBeGreaterThan(
      estimateJobDuration(plain, device).totalSeconds,
    );
  });

  it('leaves CNC output alone', () => {
    const cncProject = (settings: Partial<LayerOperationSettings>): Project => {
      const laser = plate(DEFAULT_DEVICE_PROFILE, settings);
      const layer = laser.scene.layers[0] as Layer;
      return {
        ...laser,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        scene: {
          ...laser.scene,
          layers: [
            { ...layer, cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside' } },
          ],
        },
      };
    };
    expect(emitGcode(cncProject(LEADS_ON)).gcode).toBe(emitGcode(cncProject({})).gcode);
  });

  it('keeps the lead settings through save and load', () => {
    const settings: Partial<LayerOperationSettings> = {
      ...LEADS_ON,
      leadStyle: 'line',
      leadLengthMm: 3,
      leadAngleDeg: 30,
      leadSide: 'outside',
    };
    const loaded = deserializeProject(serializeProject(plate(DEFAULT_DEVICE_PROFILE, settings)));
    if (loaded.kind !== 'ok') throw new Error('expected the project to load');
    expect(loaded.project.scene.layers[0]).toMatchObject(settings);
  });
});
