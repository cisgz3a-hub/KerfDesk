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
        polylines: [
          {
            closed: true,
            points: [
              { x: 10, y: 10 },
              { x: 10 + sizeMm, y: 10 },
              { x: 10 + sizeMm, y: 10 + sizeMm },
              { x: 10, y: 10 + sizeMm },
            ],
          },
        ],
      },
    ],
  };
}

function compileTwoStageVCarve(sizeMm: number, settings: Partial<CncLayerSettings> = {}) {
  const layer: Layer = {
    ...createLayer({ id: 'v-carve', color: '#2563eb' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'v-carve',
      toolId: V_BIT.id,
      vClearToolId: CLEAR_TOOL.id,
      depthMm: 10,
      depthPerPassMm: 1,
      vResolutionMm: 0.5,
      ...settings,
    },
  };
  const scene: Scene = { objects: [squareObject(sizeMm)], layers: [layer] };
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, MACHINE);
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

      if (rampAngleDeg === undefined) {
        expect(vcarve.passes.every((pass) => pass.kind === 'contour')).toBe(true);
      } else {
        const rampDepths = vcarve.passes.flatMap((pass) =>
          pass.kind === 'path3d' ? pass.points.map((point) => point.z) : [],
        );
        const contourDepths = vcarve.passes.flatMap((pass) =>
          pass.kind === 'contour' ? [pass.zMm] : [],
        );
        expect(Math.min(...rampDepths)).toBeCloseTo(-3, 9);
        expect(Math.min(...contourDepths)).toBeCloseTo(-3, 9);
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
