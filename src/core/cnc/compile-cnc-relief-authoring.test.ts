import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import {
  applyTransform,
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type CncTool,
} from '../scene';
import type { HeightfieldReliefObject } from '../scene/scene-object';
import type { CncPass } from '../job';
import type { Heightmap } from '../relief/heightmap';
import { compileReliefRestGroup } from './compile-cnc-relief-rest';
import { compileReliefProjectionGroups } from './compile-cnc-relief-projection';
import { reliefMachineSpaceGeometry } from './relief-machine-space';

const wide: CncTool = { id: 'wide', name: 'Predecessor', kind: 'ball-nose', diameterMm: 1 };
const fine: CncTool = { id: 'fine', name: 'Rest cutter', kind: 'ball-nose', diameterMm: 0.5 };
const config = { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: wide.id, tools: [wide, fine] };
const layer = createLayer({ id: 'cnc', color: '#a0522d' });
function target(): HeightfieldReliefObject {
  return {
    kind: 'relief',
    id: 'target',
    source: 'Owned U16 target',
    color: '#a0522d',
    reliefSource: testReliefHeightfield({
      width: 4,
      height: 4,
      physicalWidthMm: 4,
      physicalHeightMm: 4,
      maxDepthMm: 4,
      samplesU16: Array.from({ length: 16 }, () => 32768),
      revision: 3,
    }),
    targetWidthMm: 4,
    reliefDepthMm: 4,
    bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
    transform: IDENTITY_TRANSFORM,
  };
}

describe('advanced retained relief CAM compilation', () => {
  it('honours independent rest stage feeds and records actual predecessor and target revision', () => {
    const object = target(),
      map: Heightmap = {
        widthCells: 4,
        heightCells: 4,
        widthMm: 4,
        heightMm: 4,
        mmPerCell: 1,
        depth: new Float32Array(16).fill(-2),
      };
    const predecessor: CncPass = {
      kind: 'path3d',
      closed: false,
      points: [
        { x: 0, y: 2, z: -1 },
        { x: 4, y: 2, z: -1 },
      ],
    };
    const settings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      reliefFinishToolId: wide.id,
      reliefRestFinishToolId: fine.id,
      stageRecipes: {
        'relief-rest-finish': {
          toolId: fine.id,
          feedMmPerMin: 321,
          plungeMmPerMin: 123,
          spindleRpm: 8000,
          depthPerPassMm: 0.4,
        },
      },
    };
    const result = compileReliefRestGroup(
      [{ relief: object, map, passes: [predecessor] }],
      layer,
      settings,
      DEFAULT_DEVICE_PROFILE,
      config,
    );
    if (result.kind !== 'compiled') throw new Error(result.reason);
    expect(result.group?.toolId).toBe(fine.id);
    expect(result.group?.feedMmPerMin).toBe(321);
    expect(result.group?.plungeMmPerMin).toBe(123);
    expect(result.group?.spindleRpm).toBe(8000);
    expect(result.group?.cuttingStage).toBe('relief-rest-finish');
    expect(result.plans[0]).toMatchObject({
      stage: 'rest-finishing',
      predecessorToolId: wide.id,
      targetRevision: 3,
    });
    expect(result.group?.passes.length).toBeGreaterThan(0);
  });
  it('rejects missing rest intent and maps projection correctly through nonuniform scale, mirror, rotation and device origin', () => {
    expect(
      compileReliefRestGroup(
        [],
        layer,
        { ...DEFAULT_CNC_LAYER_SETTINGS, reliefRestFinishToolId: fine.id },
        DEFAULT_DEVICE_PROFILE,
        config,
      ).kind,
    ).toBe('relief-materialization-failed');
    const object = {
      ...target(),
      transform: {
        ...IDENTITY_TRANSFORM,
        x: 40,
        y: 30,
        scaleX: 2,
        scaleY: 1.5,
        rotationDeg: 30,
        mirrorX: true,
      },
    };
    const device = { ...DEFAULT_DEVICE_PROFILE, origin: 'front-right' as const },
      space = reliefMachineSpaceGeometry(object);
    const local = [
      { x: 2, y: 2 },
      { x: 6, y: 2 },
    ];
    const vector = {
      closed: false,
      points: local.map((p) => toMachineCoords(applyTransform(p, space.residualTransform), device)),
    };
    const settings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'engrave',
      reliefProjection: {
        reliefObjectId: object.id,
        depthMm: 0.3,
        depthConvention: 'vertical',
        sampleSpacingMm: 0.2,
      },
    };
    const result = compileReliefProjectionGroups([object], layer, settings, device, config, [
      vector,
    ]);
    if (result.kind !== 'compiled') throw new Error(result.reason);
    const pass = result.groups[0]?.passes[0];
    if (pass?.kind !== 'path3d') throw new Error('Missing projected path.');
    expect(pass.points[0]?.x).toBeCloseTo(vector.points[0]?.x ?? 0, 9);
    expect(pass.points[0]?.y).toBeCloseTo(vector.points[0]?.y ?? 0, 9);
    for (const p of pass.points) expect(p.z).toBeCloseTo(-4 * (1 - 32768 / 65535) - 0.3, 5);
    expect(result.plans[0]).toMatchObject({
      stage: 'projection',
      targetRevision: 3,
      verticalDepthMm: 0.3,
      requestedSampleSpacingMm: 0.2,
    });
    expect(compileReliefProjectionGroups([], layer, settings, device, config, [vector]).kind).toBe(
      'relief-materialization-failed',
    );
  });
});

it('rejects non-finite residual intent and unsupported projection depth conventions before motion planning', () => {
  const object = target();
  const map: Heightmap = {
    widthCells: 4,
    heightCells: 4,
    widthMm: 4,
    heightMm: 4,
    mmPerCell: 1,
    depth: new Float32Array(16).fill(-2),
  };
  expect(
    compileReliefRestGroup(
      [{ relief: object, map, passes: [] }],
      layer,
      {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        reliefFinishToolId: wide.id,
        reliefRestFinishToolId: fine.id,
        reliefRestResidualMm: NaN,
      },
      DEFAULT_DEVICE_PROFILE,
      config,
    ),
  ).toMatchObject({
    kind: 'relief-materialization-failed',
    reason: expect.stringContaining('finite nonnegative residual'),
  });
  expect(
    compileReliefProjectionGroups(
      [object],
      layer,
      {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'engrave',
        reliefProjection: {
          reliefObjectId: object.id,
          depthMm: 0.3,
          depthConvention: 'normal' as never,
          sampleSpacingMm: 0.2,
        },
      },
      DEFAULT_DEVICE_PROFILE,
      config,
      [],
    ),
  ).toMatchObject({
    kind: 'relief-materialization-failed',
    reason: expect.stringContaining('vertical depth convention'),
  });
});
