// H.8 compile integration: a relief layer with a finishing bit produces the
// roughing group AND a relief-finish group cut with that bit, in that
// order, both before any profile work; without one, roughing stays alone.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { computeJobBounds, frameBoundsSignature } from '../job';
import { scallopRowSpacingMm } from '../relief';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Layer,
  type ReliefObject,
  type Scene,
} from '../scene';
import type { MeshReliefObject } from '../scene/relief';
import { compileCncJob } from './compile-cnc-job';

const RELIEF_COLOR = '#a0522d';
const SMALL_BALL_NOSE: CncTool = {
  id: 'bn-0100',
  name: '0.1 mm ball nose',
  kind: 'ball-nose',
  diameterMm: 0.1,
};
const SMALL_TOOL_CONFIG: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, SMALL_BALL_NOSE],
};

// A tilted triangle mesh â€” enough surface for a real heightmap.
type ReliefOverrides = Partial<Omit<MeshReliefObject, 'reliefSource'>> &
  Partial<MeshReliefObject['reliefSource']>;

function relief(overrides: ReliefOverrides = {}): MeshReliefObject {
  const {
    meshPositions = [0, 0, 0, 12, 0, 3, 0, 12, 6],
    emptyCells = 'floor',
    ...commonOverrides
  } = overrides;
  return {
    kind: 'relief',
    id: 'R1',
    source: 'model.stl',
    targetWidthMm: 12,
    reliefDepthMm: 5,
    reliefSource: { kind: 'legacy-mesh', meshPositions, emptyCells },
    color: RELIEF_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 12, maxY: 12 },
    transform: IDENTITY_TRANSFORM,
    ...commonOverrides,
  };
}

function depthMapRelief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'D1',
    source: 'surface.png',
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 2,
      physicalWidthMm: 12,
      physicalHeightMm: 12,
      maxDepthMm: 5,
      samplesU8: [0, 255, 128, 255],
      provenance: { sourceName: 'surface.png' },
    }),
    targetWidthMm: 12,
    reliefDepthMm: 5,
    color: RELIEF_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 12, maxY: 12 },
    transform: IDENTITY_TRANSFORM,
  };
}

function shallowDepthMapRelief(): ReliefObject {
  const maxDepthMm = 0.1;
  return {
    ...depthMapRelief(),
    reliefDepthMm: maxDepthMm,
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 2,
      physicalWidthMm: 12,
      physicalHeightMm: 12,
      maxDepthMm,
      samplesU8: [0, 0, 0, 0],
      provenance: { sourceName: 'shallow.png' },
    }),
  };
}

function reliefLayer(cnc: Partial<CncLayerSettings>): Layer {
  return {
    ...createLayer({ id: RELIEF_COLOR, color: RELIEF_COLOR }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave', ...cnc },
  };
}

function compile(
  cnc: Partial<CncLayerSettings>,
  object: ReliefObject = relief(),
  device: DeviceProfile = DEFAULT_DEVICE_PROFILE,
  config: CncMachineConfig = DEFAULT_CNC_MACHINE_CONFIG,
) {
  const scene: Scene = { objects: [object], layers: [reliefLayer(cnc)] };
  return compileCncJob(scene, device, config);
}

function compiledReliefArtifact(
  object: ReliefObject,
  device: DeviceProfile = DEFAULT_DEVICE_PROFILE,
) {
  const job = compile({ reliefFinishToolId: 'bn-3175', stepoverPercent: 35 }, object, device);
  const bounds = computeJobBounds(job, device);
  if (bounds === null) throw new Error('expected relief job bounds');
  return {
    groups: job.groups.map((group) => {
      if (group.kind !== 'cnc') throw new Error('expected CNC group');
      return { cutType: group.cutType, passes: group.passes };
    }),
    frameBoundsSignature: frameBoundsSignature(bounds),
  };
}

describe('relief finishing compile (H.8)', () => {
  it('routes a durable depth map through existing relief roughing and finishing CAM', () => {
    const job = compile({ reliefFinishToolId: 'bn-3175' }, depthMapRelief());
    const groups = job.groups.filter((group) => group.kind === 'cnc');

    expect(groups.map((group) => group.cutType)).toEqual(['relief-rough', 'relief-finish']);
    expect(groups.every((group) => group.passes.length > 0)).toBe(true);
  });

  it('keeps a selected finishing skim when the relief is shallower than roughing allowance', () => {
    const object = shallowDepthMapRelief();
    expect(compile({}, object).groups).toHaveLength(0);
    const job = compile({ reliefFinishToolId: 'bn-3175' }, object);
    const groups = job.groups.filter((group) => group.kind === 'cnc');

    expect(groups.map((group) => group.cutType)).toEqual(['relief-finish']);
    const finish = groups[0];
    if (finish?.kind !== 'cnc') throw new Error('finish group missing');
    expect(finish.toolId).toBe('bn-3175');
    expect(finish.layerPrimaryToolId).toBe(DEFAULT_CNC_MACHINE_CONFIG.toolId);
    expect(finish.passes.length).toBeGreaterThan(0);
    expect(finish.passes.every((pass) => pass.kind === 'path3d')).toBe(true);
    for (const pass of finish.passes) {
      if (pass.kind !== 'path3d') continue;
      for (const point of pass.points) expect(point.z).toBeCloseTo(-0.1, 6);
    }
  });

  it('adds a relief-finish group with the finishing bit after roughing', () => {
    const job = compile({ reliefFinishToolId: 'bn-3175' });
    const cutTypes = job.groups.map((group) => (group.kind === 'cnc' ? group.cutType : ''));
    expect(cutTypes).toEqual(['relief-rough', 'relief-finish']);
    const finish = job.groups[1];
    if (finish?.kind !== 'cnc') throw new Error('finish group missing');
    expect(finish.toolId).toBe('bn-3175');
    expect(finish.layerPrimaryToolId).toBe(DEFAULT_CNC_MACHINE_CONFIG.toolId);
    expect(finish.depthPerPassMm).toBeUndefined();
    expect(finish.passes.every((pass) => pass.kind === 'path3d')).toBe(true);
    // Every finishing Z stays within the relief's depth range.
    for (const pass of finish.passes) {
      if (pass.kind !== 'path3d') continue;
      for (const point of pass.points) {
        expect(point.z).toBeLessThanOrEqual(0 + 1e-6);
        expect(point.z).toBeGreaterThanOrEqual(-5 - 1e-6);
      }
    }
  });

  it('stays roughing-only without a finishing bit and for unknown bit ids', () => {
    expect(compile({}).groups.map((group) => (group.kind === 'cnc' ? group.cutType : ''))).toEqual([
      'relief-rough',
    ]);
    expect(
      compile({ reliefFinishToolId: 'nope' }).groups.map((group) =>
        group.kind === 'cnc' ? group.cutType : '',
      ),
    ).toEqual(['relief-rough']);
  });

  it.each([0.5, 2])(
    'plans uniform XY scale %s in physical millimetres before cutter dilation and spacing',
    (scale) => {
      const physicalWidth = 12 * scale;
      const scaled = relief({
        transform: { ...IDENTITY_TRANSFORM, scaleX: scale, scaleY: scale },
      });
      const samePhysicalSurface = relief({
        targetWidthMm: physicalWidth,
        bounds: { minX: 0, minY: 0, maxX: physicalWidth, maxY: physicalWidth },
      });

      expect(compiledReliefArtifact(scaled)).toEqual(compiledReliefArtifact(samePhysicalSurface));
    },
  );

  it('plans nonuniform XY scaling in a square machine-space metric', () => {
    const scaled = relief({
      transform: { ...IDENTITY_TRANSFORM, scaleX: 0.5, scaleY: 2 },
    });
    const samePhysicalSurface = relief({
      meshPositions: [0, 0, 0, 12, 0, 3, 0, 48, 6],
      targetWidthMm: 6,
      bounds: { minX: 0, minY: 0, maxX: 6, maxY: 24 },
    });

    const first = compiledReliefArtifact(scaled);
    expect(first).toEqual(compiledReliefArtifact(samePhysicalSurface));
    expect(first).toEqual(compiledReliefArtifact(scaled));
  });

  it('preserves negative scale, explicit mirrors, rotation, translation, and device origin', () => {
    const device: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-right' };
    const placement = {
      x: 73,
      y: 91,
      rotationDeg: 37,
      mirrorX: true,
      mirrorY: true,
    };
    const transformed = relief({
      transform: { ...placement, scaleX: -0.5, scaleY: 2 },
    });
    const samePhysicalSurface = relief({
      meshPositions: [0, 0, 0, 12, 0, 3, 0, 48, 6],
      targetWidthMm: 6,
      bounds: { minX: 0, minY: 0, maxX: 6, maxY: 24 },
      transform: { ...placement, scaleX: -1, scaleY: 1 },
    });

    expect(compiledReliefArtifact(transformed, device)).toEqual(
      compiledReliefArtifact(samePhysicalSurface, device),
    );
  });

  it('retains zero-axis compatibility as deterministic collapsed centerline output', () => {
    const collapsed = relief({
      transform: { ...IDENTITY_TRANSFORM, x: 17, y: 23, scaleX: 0 },
    });
    const job = compile({ reliefFinishToolId: 'bn-3175' }, collapsed);
    const points = job.groups.flatMap((group) =>
      group.kind === 'cnc'
        ? group.passes.flatMap((pass) =>
            pass.kind === 'path3d' ? pass.points : pass.kind === 'contour' ? pass.polyline : [],
          )
        : [],
    );
    const bounds = computeJobBounds(job, DEFAULT_DEVICE_PROFILE);

    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => Math.abs(point.x - 17) < 1e-9)).toBe(true);
    expect(bounds?.minX).toBeCloseTo(17, 9);
    expect(bounds?.maxX).toBeCloseTo(17, 9);
    expect(compiledReliefArtifact(collapsed)).toEqual(compiledReliefArtifact(collapsed));
  });

  it('refines the finishing grid so integer rows do not overshoot requested spacing', () => {
    const scallopMm = 0.005;
    const job = compile({ reliefFinishToolId: 'bn-3175', reliefScallopMm: scallopMm });
    const finish = job.groups.find(
      (group) => group.kind === 'cnc' && group.cutType === 'relief-finish',
    );
    if (finish?.kind !== 'cnc') throw new Error('finish group missing');
    const rowYs = finish.passes.map((pass) => {
      if (pass.kind !== 'path3d' || pass.points[0] === undefined) {
        throw new Error('path3d row expected');
      }
      return pass.points[0].y;
    });
    const maxGap = Math.max(...rowYs.slice(1).map((y, index) => Math.abs(y - (rowYs[index] ?? y))));
    const tool = DEFAULT_CNC_MACHINE_CONFIG.tools.find((candidate) => candidate.id === 'bn-3175');
    if (tool === undefined) throw new Error('ball-nose fixture tool missing');

    expect(maxGap).toBeLessThanOrEqual(scallopRowSpacingMm(tool, scallopMm) + 1e-9);
  });

  it('honors the supported minimum ball-nose planar cusp below the flat-tool row floor', () => {
    const scallopMm = 0.005;
    const job = compile(
      { reliefFinishToolId: SMALL_BALL_NOSE.id, reliefScallopMm: scallopMm },
      relief(),
      DEFAULT_DEVICE_PROFILE,
      SMALL_TOOL_CONFIG,
    );
    const finish = job.groups.find(
      (group) => group.kind === 'cnc' && group.cutType === 'relief-finish',
    );
    if (finish?.kind !== 'cnc') throw new Error('small-tool finish group missing');
    const rowYs = finish.passes.map((pass) => {
      if (pass.kind !== 'path3d' || pass.points[0] === undefined) {
        throw new Error('path3d row expected');
      }
      return pass.points[0].y;
    });
    const maxGap = Math.max(...rowYs.slice(1).map((y, index) => Math.abs(y - (rowYs[index] ?? y))));
    const radius = SMALL_BALL_NOSE.diameterMm / 2;
    const planarCusp = radius - Math.sqrt(radius * radius - (maxGap * maxGap) / 4);
    const finishPlan = job.cncCompilation?.reliefPlans?.find((plan) => plan.stage === 'finishing');

    expect(maxGap).toBeLessThan(0.05);
    expect(maxGap).toBeLessThanOrEqual(scallopRowSpacingMm(SMALL_BALL_NOSE, scallopMm) + 1e-9);
    expect(planarCusp).toBeLessThanOrEqual(scallopMm + 1e-12);
    expect(finishPlan?.cellSizeMm).toBeCloseTo(SMALL_BALL_NOSE.diameterMm / 10, 12);
  });

  it('does not floor roughing resolution for a small exact tool', () => {
    const object = relief({
      meshPositions: [0, 0, 0, 0.2, 0, 0.1, 0, 0.2, 0.2],
      targetWidthMm: 0.2,
      bounds: { minX: 0, minY: 0, maxX: 0.2, maxY: 0.2 },
    });
    const job = compile(
      { toolId: SMALL_BALL_NOSE.id },
      object,
      DEFAULT_DEVICE_PROFILE,
      SMALL_TOOL_CONFIG,
    );
    const roughingPlan = job.cncCompilation?.reliefPlans?.find((plan) => plan.stage === 'roughing');

    expect(roughingPlan?.cellSizeMm).toBeCloseTo(SMALL_BALL_NOSE.diameterMm / 8, 12);
  });
});
