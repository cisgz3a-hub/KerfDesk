import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc';
import type { CncPass } from '../../core/job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncMachineConfig,
  type CncTool,
  type Project,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

const LAYER_ID = 'v-carve';
const OBJECT_ID = 'square';
const CUT_COLOR = '#ff0000';
const SQUARE_SIZE_MM = 4;
const FLAT_DEPTH_MM = 1;
const V_BIT: CncTool = {
  id: 'v90',
  name: '90 degree V-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};
const MACHINE: CncMachineConfig = {
  kind: 'cnc',
  stock: {
    thicknessMm: 6,
    widthMm: 100,
    heightMm: 100,
    originOffset: { x: 0, y: 0 },
  },
  tools: [V_BIT],
  toolId: V_BIT.id,
  params: { safeZMm: 3, spindleMaxRpm: 12_000, spindleSpinupSec: 0 },
};

function vCarveProject(vCarveFlatDepthEnabled: boolean): Project {
  const base = createProject();
  return {
    ...base,
    machine: MACHINE,
    scene: {
      objects: [
        {
          kind: 'imported-svg',
          id: OBJECT_ID,
          source: 'square.svg',
          bounds: { minX: 10, minY: 10, maxX: 14, maxY: 14 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: CUT_COLOR,
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 10, y: 10 },
                    { x: 10 + SQUARE_SIZE_MM, y: 10 },
                    { x: 10 + SQUARE_SIZE_MM, y: 10 + SQUARE_SIZE_MM },
                    { x: 10, y: 10 + SQUARE_SIZE_MM },
                  ],
                },
              ],
            },
          ],
        },
      ],
      layers: [
        {
          ...createLayer({ id: LAYER_ID, color: CUT_COLOR }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'v-carve',
            depthMm: FLAT_DEPTH_MM,
            depthPerPassMm: FLAT_DEPTH_MM,
            vResolutionMm: 0.1,
            vCarveFlatDepthEnabled,
          },
        },
      ],
    },
  };
}

function deserializeOk(text: string): Project {
  const result = deserializeProject(text);
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result.project;
}

function withoutPersistedFlatDepthFlag(project: Project): Project {
  const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>;
  const scene = raw['scene'] as { layers: Array<Record<string, unknown>> };
  const cnc = scene.layers[0]?.['cnc'] as Record<string, unknown>;
  delete cnc['vCarveFlatDepthEnabled'];
  return deserializeOk(`${JSON.stringify(raw)}\n`);
}

function compiledPasses(project: Project): ReadonlyArray<CncPass> {
  if (project.machine?.kind !== 'cnc') throw new Error('expected CNC machine');
  const group = compileCncJob(project.scene, project.device, project.machine).groups[0];
  if (group?.kind !== 'cnc') throw new Error('expected CNC group');
  return group.passes;
}

function deepestCutMm(passes: ReadonlyArray<CncPass>): number {
  return Math.max(
    ...passes.flatMap((pass) => {
      if (pass.kind === 'contour') return [-pass.zMm];
      if (pass.kind === 'path3d') return pass.points.map((point) => -point.z);
      return [];
    }),
  );
}

function expectFlatFloor(passes: ReadonlyArray<CncPass>): void {
  expect(deepestCutMm(passes)).toBeCloseTo(FLAT_DEPTH_MM, 9);
  expect(
    passes.some(
      (pass) =>
        pass.kind === 'path3d' &&
        pass.points.some((point) => Math.abs(point.z + FLAT_DEPTH_MM) <= 1e-9),
    ),
  ).toBe(true);
}

describe('.lf2 V-carve flat-depth compatibility', () => {
  it('gives newly created settings an explicit flowing-depth default', () => {
    expect(DEFAULT_CNC_LAYER_SETTINGS.vCarveFlatDepthEnabled).toBe(false);
  });

  it('keeps a legacy absent flag absent and compiles the historical depth cap', () => {
    const loaded = withoutPersistedFlatDepthFlag(vCarveProject(false));
    expect(loaded.scene.layers[0]?.cnc).not.toHaveProperty('vCarveFlatDepthEnabled');
    expectFlatFloor(compiledPasses(loaded));
  });

  it('round-trips explicit false and compiles ordinary flowing depth', () => {
    const loaded = deserializeOk(serializeProject(vCarveProject(false)));
    expect(loaded.scene.layers[0]?.cnc?.vCarveFlatDepthEnabled).toBe(false);
    const passes = compiledPasses(loaded);
    expect(deepestCutMm(passes)).toBeGreaterThan(FLAT_DEPTH_MM + 0.5);
    expect(passes.every((pass) => pass.kind === 'path3d')).toBe(true);
  });

  it('round-trips explicit true and compiles the requested flat floor', () => {
    const loaded = deserializeOk(serializeProject(vCarveProject(true)));
    expect(loaded.scene.layers[0]?.cnc?.vCarveFlatDepthEnabled).toBe(true);
    expectFlatFloor(compiledPasses(loaded));
  });
});
