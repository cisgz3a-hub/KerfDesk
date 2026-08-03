import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup } from '../job';
import { cncGrblStrategy } from '../output';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const V_BIT: CncTool = {
  id: 'custom-v90-6',
  name: '6 mm 90 degree V-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};

const CLEAR_TOOL: CncTool = {
  id: 'clear-3',
  name: '3 mm clearing end mill',
  kind: 'end-mill',
  diameterMm: 3,
};

const MACHINE: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  toolId: V_BIT.id,
  tools: [V_BIT, CLEAR_TOOL],
};

function square(minX: number, minY: number, sizeMm: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: minX + sizeMm, y: minY },
      { x: minX + sizeMm, y: minY + sizeMm },
      { x: minX, y: minY + sizeMm },
    ],
  };
}

function squareObject(sizeMm: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: `square-${sizeMm}`,
    source: `square-${sizeMm}.svg`,
    bounds: { minX: 10, minY: 10, maxX: 10 + sizeMm, maxY: 10 + sizeMm },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#2563eb',
        polylines: [square(10, 10, sizeMm)],
      },
    ],
  };
}

function twoRegionSquareObject(sizeMm: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'two-squares',
    source: 'two-squares.svg',
    bounds: { minX: 10, minY: 10, maxX: 70 + sizeMm, maxY: 10 + sizeMm },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#2563eb',
        // Source order is intentionally opposite geometric X order.
        polylines: [square(70, 10, sizeMm), square(10, 10, sizeMm)],
      },
    ],
  };
}

function compileTwoStageVCarve(
  sizeMm: number,
  settings: Partial<CncLayerSettings> = {},
  object: ImportedSvg = squareObject(sizeMm),
) {
  const layer: Layer = {
    ...createLayer({ id: 'v-carve', color: '#2563eb' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'v-carve',
      vCarveFlatDepthEnabled: true,
      toolId: V_BIT.id,
      vClearToolId: CLEAR_TOOL.id,
      depthMm: 10,
      depthPerPassMm: 1,
      vResolutionMm: 0.5,
      ...settings,
    },
  };
  const scene: Scene = { objects: [object], layers: [layer] };
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, MACHINE);
}

function compress<T>(values: ReadonlyArray<T>): ReadonlyArray<T> {
  return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}

function requiredGroup(
  job: ReturnType<typeof compileTwoStageVCarve>,
  cutType: 'pocket' | 'v-carve',
): CncGroup {
  const group = job.groups.find(
    (candidate) => candidate.kind === 'cnc' && candidate.cutType === cutType,
  );
  if (group?.kind !== 'cnc') throw new Error(`expected ${cutType} group`);
  return group;
}

function deepestZ(group: CncGroup): number {
  return Math.min(
    ...group.passes.flatMap((pass) =>
      pass.kind === 'path3d' ? pass.points.map((point) => point.z) : [pass.zMm],
    ),
  );
}

function deepestEmittedZ(gcode: string): number {
  return Math.min(
    ...gcode.split('\n').flatMap((line) => {
      const match = /(?:^|\s)Z(-?\d+(?:\.\d+)?)(?:\s|$)/.exec(line);
      return match?.[1] === undefined ? [] : [Number(match[1])];
    }),
  );
}

describe('two-stage V-carve effective floor depth', () => {
  it('clears every depth of the first source region before starting the second', () => {
    const job = compileTwoStageVCarve(40, { depthMm: 3 }, twoRegionSquareObject(40));
    const clearance = requiredGroup(job, 'pocket');
    const sequence = clearance.passes.map((pass) => {
      if (pass.kind !== 'contour') throw new Error('expected a contour pass');
      const minX = Math.min(...pass.polyline.map((point) => point.x));
      const source = minX > 50 ? 'first' : 'second';
      return `${source}:${pass.zMm}`;
    });

    expect(compress(sequence)).toEqual([
      'first:-1',
      'first:-2',
      'first:-3',
      'second:-1',
      'second:-2',
      'second:-3',
    ]);
  });

  it.each([undefined, 3] as const)(
    'keeps the effective flat-floor region on a 20 mm shape with ramp angle %s',
    (rampAngleDeg) => {
      const job = compileTwoStageVCarve(20, {
        ...(rampAngleDeg === undefined ? {} : { vCarveRampEntryDeg: rampAngleDeg }),
      });
      const clearance = requiredGroup(job, 'pocket');
      const vcarve = requiredGroup(job, 'v-carve');
      expect(clearance.passes.length).toBeGreaterThan(0);
      expect(deepestZ(clearance)).toBeCloseTo(-3, 9);
      expect(deepestZ(vcarve)).toBeCloseTo(-3, 9);
      expect(deepestEmittedZ(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE))).toBeCloseTo(-3, 9);
    },
  );

  it.each([undefined, 3] as const)(
    'puts both cutters on the same 3 mm floor with ramp angle %s',
    (rampAngleDeg) => {
      const job = compileTwoStageVCarve(40, {
        ...(rampAngleDeg === undefined ? {} : { vCarveRampEntryDeg: rampAngleDeg }),
      });
      const clearance = requiredGroup(job, 'pocket');
      const vcarve = requiredGroup(job, 'v-carve');

      expect(deepestZ(clearance)).toBeCloseTo(-3, 9);
      expect(deepestZ(vcarve)).toBeCloseTo(-3, 9);
      expect(deepestEmittedZ(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE))).toBeCloseTo(-3, 9);

      const detailPasses = vcarve.passes.filter((pass) => pass.kind === 'path3d');
      expect(detailPasses).toHaveLength(vcarve.passes.length);
      expect(
        Math.min(...detailPasses.flatMap((pass) => pass.points.map(({ z }) => z))),
      ).toBeCloseTo(-3, 9);
      expect(
        detailPasses.every(
          (pass) => pass.lateralFeed === 'z-rate-capped' && pass.entryRamp === undefined,
        ),
      ).toBe(true);

      const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
      if (rampAngleDeg === undefined) {
        expect(gcode).not.toContain('; cnc entry:');
      } else {
        expect(gcode).toContain('; cnc entry: medial-profile; max-angle-deg: 3.000');
      }
    },
  );

  it.each([undefined, 3] as const)(
    'leaves a shallower-than-cone two-stage carve at its requested floor with ramp angle %s',
    (rampAngleDeg) => {
      const job = compileTwoStageVCarve(40, {
        depthMm: 2,
        ...(rampAngleDeg === undefined ? {} : { vCarveRampEntryDeg: rampAngleDeg }),
      });
      expect(deepestZ(requiredGroup(job, 'pocket'))).toBeCloseTo(-2, 9);
      expect(deepestZ(requiredGroup(job, 'v-carve'))).toBeCloseTo(-2, 9);
      expect(deepestEmittedZ(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE))).toBeCloseTo(-2, 9);
    },
  );
});
