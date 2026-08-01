import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncMachineConfig,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const V_BIT = {
  id: 'custom-v-3mm-90',
  name: 'Custom 3 mm 90 degree V-bit',
  kind: 'v-bit' as const,
  diameterMm: 3,
  tipAngleDeg: 90,
};

const MACHINE: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  toolId: V_BIT.id,
  tools: [V_BIT],
};

const OBJECT: ImportedSvg = {
  kind: 'imported-svg',
  id: 'square',
  source: 'square.svg',
  bounds: { minX: 20, minY: 20, maxX: 40, maxY: 40 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#336699',
      polylines: [
        {
          closed: true,
          points: [
            { x: 20, y: 20 },
            { x: 40, y: 20 },
            { x: 40, y: 40 },
            { x: 20, y: 40 },
          ],
        },
      ],
    },
  ],
};

function vCarveScene(): Scene {
  return {
    objects: [OBJECT],
    layers: [
      {
        ...createLayer({ id: 'v-carve-operation', color: '#336699' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'v-carve',
          toolId: V_BIT.id,
          depthMm: 1.191,
          depthPerPassMm: 0.5,
          vResolutionMm: 0,
          feedMmPerMin: 150,
          plungeMmPerMin: 150,
          spindleRpm: 10_000,
          feedSource: {
            kind: 'material-recipe',
            materialKey: 'hardwood',
            fluteCount: 2,
          },
        },
      },
    ],
  };
}

describe('compiled CNC provenance', () => {
  it('keeps the exact V-bit geometry and requested settings beside the passes', () => {
    const group = compileCncJob(vCarveScene(), DEFAULT_DEVICE_PROFILE, MACHINE).groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected one CNC group');

    expect(group).toMatchObject({
      toolId: V_BIT.id,
      toolName: V_BIT.name,
      toolKind: 'v-bit',
      toolTipAngleDeg: 90,
      toolDiameterMm: 3,
      requestedDepthMm: 1.191,
      depthPerPassMm: 0.5,
      vResolutionMm: 0,
      feedMmPerMin: 150,
      plungeMmPerMin: 150,
      spindleRpm: 10_000,
      feedSource: {
        kind: 'material-recipe',
        materialKey: 'hardwood',
        fluteCount: 2,
      },
    });
  });
});
