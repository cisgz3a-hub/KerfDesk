import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { compileCncJob } from '../cnc/compile-cnc-job';
import { segmentToSegmentDistance } from '../cnc/vcarve-detail-geometry';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { pointInPolygon } from '../geometry';
import type { CncPass, Job } from '../job';
import { cncGrblStrategy } from '../output';
import {
  applyTransform,
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncTool,
  type ReliefObject,
  type Scene,
  type Transform,
  type Vec2,
} from '../scene';
import { cuttingSurfaceDz } from '../sim/tool-kernels';
import type { Heightmap } from './heightmap';
import { reliefRoughingPasses } from './relief-roughing';

const RELIEF_COLOR = '#79512f';
const DEVICE = { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' as const };

type MaskEmissionCase = {
  readonly name: string;
  readonly tool: CncTool;
  readonly cellMm: number;
  readonly columns: number;
  readonly includedColumns: number;
  readonly stepoverPercent: number;
  readonly scallopMm: number;
  readonly transform: Transform;
};

const MASK_EMISSION_CASES: ReadonlyArray<MaskEmissionCase> = [
  {
    name: 'fractional end-mill grid with sub-quantum translation',
    tool: { id: 'mask-flat-2', name: '2 mm end mill', kind: 'end-mill', diameterMm: 2 },
    cellMm: 1.0001 / 5.5,
    columns: 24,
    includedColumns: 20,
    stepoverPercent: (1.0001 / 5.5 / 2) * 100,
    scallopMm: 0.025,
    transform: { ...IDENTITY_TRANSFORM, x: 0.0006, y: 20.0004 },
  },
  {
    name: 'ball-nose tangent under rotation and translation',
    tool: { id: 'mask-ball-2', name: '2 mm ball nose', kind: 'ball-nose', diameterMm: 2 },
    cellMm: 0.2,
    columns: 25,
    includedColumns: 20,
    stepoverPercent: 40,
    scallopMm: 0.025,
    transform: {
      ...IDENTITY_TRANSFORM,
      x: 50.0004,
      y: 40.0006,
      rotationDeg: 37,
    },
  },
  {
    name: 'conical tangent under mirror, rotation, and translation',
    tool: {
      id: 'mask-v-2',
      name: '2 mm 60 degree V-bit',
      kind: 'v-bit',
      diameterMm: 2,
      tipAngleDeg: 60,
    },
    cellMm: 0.2,
    columns: 25,
    includedColumns: 20,
    stepoverPercent: 10,
    scallopMm: 0.025,
    transform: {
      ...IDENTITY_TRANSFORM,
      x: 90.0004,
      y: 70.0006,
      rotationDeg: -23,
      mirrorX: true,
    },
  },
];

describe('relief mask safety at emitted G-code precision', () => {
  it.each(MASK_EMISSION_CASES)('$name', (candidate) => {
    const job = compileMaskedRelief(candidate);
    const cutTypes = job.groups.map((group) => (group.kind === 'cnc' ? group.cutType : ''));
    expect(cutTypes).toContain('relief-rough');
    expect(cutTypes).toContain('relief-finish');
    const finishingPlan = job.cncCompilation?.reliefPlans?.find(
      (plan) => plan.stage === 'finishing',
    );
    expect(finishingPlan?.cellSizeMm).toBeCloseTo(candidate.cellMm, 12);

    const gcode = cncGrblStrategy.emit(job, DEVICE);
    const motions = emittedLinearMotions(gcode).filter(
      (motion) => Math.min(motion.from.z, motion.to.z) < 0,
    );
    expect(motions.length).toBeGreaterThan(0);
    expect(expectMinimumMaskMargin(candidate, motions)).toBeGreaterThanOrEqual(-1e-12);
  });

  it.each([
    {
      name: 'fractional flat-tool roughing',
      tool: { id: 'rough-flat-2', name: '2 mm end mill', kind: 'end-mill', diameterMm: 2 },
      cellMm: 1 / 4.2,
      reliefDepthMm: 1,
      depthPerPassMm: 0.2,
      expectedDepths: ['Z-0.200'],
    },
    {
      name: 'shallow ball-nose roughing levels',
      tool: { id: 'rough-ball-2', name: '2 mm ball nose', kind: 'ball-nose', diameterMm: 2 },
      cellMm: 0.25,
      reliefDepthMm: 0.5,
      depthPerPassMm: 0.2,
      expectedDepths: ['Z-0.200', 'Z-0.500'],
    },
  ] satisfies ReadonlyArray<{
    readonly name: string;
    readonly tool: CncTool;
    readonly cellMm: number;
    readonly reliefDepthMm: number;
    readonly depthPerPassMm: number;
    readonly expectedDepths: ReadonlyArray<string>;
  }>)('$name remains safe before and after emission', (roughing) => {
    const candidate = directRoughingCandidate(roughing.tool, roughing.cellMm);
    const passes = reliefRoughingPasses(directMaskedMap(candidate), {
      tool: roughing.tool,
      reliefDepthMm: roughing.reliefDepthMm,
      depthPerPassMm: roughing.depthPerPassMm,
      stepoverPercent: 40,
      allowanceMm: 0,
    });
    expect(passes.length).toBeGreaterThan(0);
    const gcode = cncGrblStrategy.emit(roughingJob(roughing.tool, passes), DEVICE);
    for (const expectedDepth of roughing.expectedDepths) expect(gcode).toContain(expectedDepth);
    const motions = emittedLinearMotions(gcode).filter(
      (motion) => Math.min(motion.from.z, motion.to.z) < 0,
    );
    expect(expectMinimumMaskMargin(candidate, motions)).toBeGreaterThanOrEqual(-1e-12);
  });
});

function directRoughingCandidate(tool: CncTool, cellMm: number): MaskEmissionCase {
  return {
    name: tool.name,
    tool,
    cellMm,
    columns: 24,
    includedColumns: 20,
    stepoverPercent: 40,
    scallopMm: 0.025,
    transform: IDENTITY_TRANSFORM,
  };
}

function directMaskedMap(candidate: MaskEmissionCase): Heightmap {
  const inclusion = new Uint8Array(candidate.columns).fill(1);
  inclusion.fill(0, candidate.includedColumns);
  return {
    widthCells: candidate.columns,
    heightCells: 1,
    mmPerCell: candidate.cellMm,
    depth: new Float32Array(candidate.columns).fill(-2),
    inclusion,
  };
}

function roughingJob(tool: CncTool, passes: ReadonlyArray<CncPass>): Job {
  return {
    groups: [
      {
        kind: 'cnc',
        layerId: 'mask-roughing',
        color: RELIEF_COLOR,
        cutType: 'relief-rough',
        toolId: tool.id,
        toolName: tool.name,
        toolDiameterMm: tool.diameterMm,
        feedMmPerMin: 1000,
        plungeMmPerMin: 300,
        spindleRpm: 12_000,
        spindleSpinupSec: 0,
        safeZMm: 3,
        retractBetweenPasses: false,
        passes,
      },
    ],
  };
}

function compileMaskedRelief(candidate: MaskEmissionCase) {
  const widthMm = candidate.columns * candidate.cellMm;
  const heightMm = candidate.cellMm;
  const relief: ReliefObject = {
    kind: 'relief',
    id: `relief-${candidate.tool.id}`,
    source: `${candidate.tool.id}.png`,
    reliefSource: testReliefHeightfield({
      width: candidate.columns,
      height: 1,
      physicalWidthMm: widthMm,
      physicalHeightMm: heightMm,
      maxDepthMm: 2,
      samplesU8: Array.from({ length: candidate.columns }, () => 0),
      inclusionMask: Array.from({ length: candidate.columns }, (_, col) =>
        col < candidate.includedColumns ? 255 : 0,
      ),
    }),
    targetWidthMm: widthMm,
    reliefDepthMm: 2,
    color: RELIEF_COLOR,
    bounds: { minX: 0, minY: 0, maxX: widthMm, maxY: heightMm },
    transform: candidate.transform,
  };
  const scene: Scene = {
    objects: [relief],
    layers: [
      {
        ...createLayer({ id: RELIEF_COLOR, color: RELIEF_COLOR }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'engrave',
          toolId: candidate.tool.id,
          reliefFinishToolId: candidate.tool.id,
          reliefScallopMm: candidate.scallopMm,
          stepoverPercent: candidate.stepoverPercent,
          depthPerPassMm: 0.2,
        },
      },
    ],
  };
  return compileCncJob(scene, DEVICE, {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    toolId: candidate.tool.id,
    tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, candidate.tool],
  });
}

type Point3 = { readonly x: number; readonly y: number; readonly z: number };
type ModalPoint3 = {
  readonly x: number | undefined;
  readonly y: number | undefined;
  readonly z: number | undefined;
};
type LinearMotion = { readonly from: Point3; readonly to: Point3; readonly line: string };

function emittedLinearMotions(gcode: string): ReadonlyArray<LinearMotion> {
  const motions: LinearMotion[] = [];
  let position: ModalPoint3 = { x: undefined, y: undefined, z: undefined };
  for (const line of gcode.split(/\r?\n/u)) {
    const mode = /^(G0|G1)\b/u.exec(line)?.[1];
    if (mode === undefined) continue;
    const next = {
      x: coordinateWord(line, 'X', position.x),
      y: coordinateWord(line, 'Y', position.y),
      z: coordinateWord(line, 'Z', position.z),
    };
    if (mode === 'G1' && isPoint3(position) && isPoint3(next)) {
      motions.push({ from: position, to: next, line });
    }
    position = next;
  }
  return motions;
}

function coordinateWord(
  line: string,
  axis: 'X' | 'Y' | 'Z',
  previous?: number,
): number | undefined {
  const match = new RegExp(`${axis}(-?\\d+(?:\\.\\d+)?)`, 'u').exec(line);
  return match?.[1] === undefined ? previous : Number(match[1]);
}

function isPoint3(point: ModalPoint3): point is Point3 {
  return point.x !== undefined && point.y !== undefined && point.z !== undefined;
}

function expectMinimumMaskMargin(
  candidate: MaskEmissionCase,
  motions: ReadonlyArray<LinearMotion>,
): number {
  const radiusMm = candidate.tool.diameterMm / 2;
  const excluded = excludedCellPolygons(candidate);
  let minimum = Number.POSITIVE_INFINITY;
  for (const motion of motions) {
    const minimumZ = Math.min(motion.from.z, motion.to.z);
    for (const polygon of excluded) {
      const distanceMm = segmentPolygonDistance(motion.from, motion.to, polygon);
      const margin =
        distanceMm > radiusMm
          ? distanceMm - radiusMm
          : minimumZ + cuttingSurfaceDz(candidate.tool, distanceMm, radiusMm);
      expect(margin, `excluded-stock margin for ${motion.line}`).toBeGreaterThanOrEqual(-1e-12);
      minimum = Math.min(minimum, margin);
    }
  }
  return minimum;
}

function excludedCellPolygons(candidate: MaskEmissionCase): ReadonlyArray<ReadonlyArray<Vec2>> {
  const polygons: Vec2[][] = [];
  for (let col = candidate.includedColumns; col < candidate.columns; col += 1) {
    const minX = col * candidate.cellMm;
    const maxX = (col + 1) * candidate.cellMm;
    polygons.push(
      [
        { x: minX, y: 0 },
        { x: maxX, y: 0 },
        { x: maxX, y: candidate.cellMm },
        { x: minX, y: candidate.cellMm },
      ].map((point) => applyTransform(point, candidate.transform)),
    );
  }
  return polygons;
}

function segmentPolygonDistance(from: Vec2, to: Vec2, polygon: ReadonlyArray<Vec2>): number {
  if (pointInPolygon(from, polygon) || pointInPolygon(to, polygon)) return 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (start === undefined || end === undefined) continue;
    minimum = Math.min(
      minimum,
      segmentToSegmentDistance(from, to, {
        ax: start.x,
        ay: start.y,
        bx: end.x,
        by: end.y,
      }),
    );
  }
  return minimum;
}
