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
  type CurveSubpath,
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

const K = (4 / 3) * Math.tan(Math.PI / 8);

/** A circle as four cubic quarters, counter-clockwise from its right. */
function circle(cx: number, cy: number, r: number): CurveSubpath {
  const k = K * r;
  const quarter = (to: Vec2, c1: Vec2, c2: Vec2) => ({
    kind: 'cubic' as const,
    control1: c1,
    control2: c2,
    to,
  });
  const right = { x: cx + r, y: cy };
  const top = { x: cx, y: cy + r };
  const left = { x: cx - r, y: cy };
  const bottom = { x: cx, y: cy - r };
  return {
    start: right,
    closed: true,
    segments: [
      quarter(top, { x: cx + r, y: cy + k }, { x: cx + k, y: cy + r }),
      quarter(left, { x: cx - k, y: cy + r }, { x: cx - r, y: cy + k }),
      quarter(bottom, { x: cx - r, y: cy - k }, { x: cx - k, y: cy - r }),
      quarter(right, { x: cx + k, y: cy - r }, { x: cx + r, y: cy - k }),
    ],
  };
}

/** A 10 mm disc on an arc machine: two passes, a 1 mm overcut, leads on. */
function disc(): Project {
  const layer: Layer = {
    ...createLayer({ id: 'cut', color: '#ff0000' }),
    ...LEADS_ON,
    passes: 2,
    overcutMm: 1,
  };
  const outline = circle(40, 40, 5);
  return {
    ...createProject(ARC_DEVICE),
    scene: {
      layers: [layer],
      objects: [
        {
          kind: 'imported-svg',
          id: 'disc',
          source: 'disc.svg',
          bounds: { minX: 35, minY: 35, maxX: 45, maxY: 45 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [{ points: [outline.start], closed: true }],
              curves: [outline],
            },
          ],
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

  it('pins the G2/G3 leads of an arc contour and the lead-out after the final overcut', () => {
    const lines = emitGcode(disc()).gcode.split('\n');
    const passes = lines.flatMap((line, index) => (line.startsWith('; pass ') ? [index] : []));
    const [first, second] = passes;
    if (first === undefined || second === undefined) throw new Error('expected two passes');
    const burns = (from: number, to?: number) =>
      lines.slice(from + 1, to).filter((line) => /^G[123] /.test(line));
    const pass1 = burns(first, second);
    const pass2 = burns(second);
    // Pass 1 goes out as G2/G3: an arc lead-in, the circle, an arc lead-out.
    expect(pass1[0]).toMatch(/^G[23] /);
    expect(pass1.at(-1)).toMatch(/^G[23] /);
    // The final pass is chords (ADR-415): round once, on past the start by the
    // overcut, then its own lead-out.
    expect(pass2.some((line) => /^G[23] /.test(line))).toBe(false);
    const start = pass1[0]?.match(/X\S+ Y\S+/)?.[0] ?? '';
    expect(pass2.filter((line) => line.includes(start))).toHaveLength(2);
    expect(pass2.at(-1)).not.toContain(start);
    expect(lines.slice(first).join('\n')).toMatchSnapshot();
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
