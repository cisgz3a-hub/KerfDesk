import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncCutDirection,
  type CncCutType,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const INERT_CUT_TYPES: ReadonlyArray<CncCutType> = ['profile-on-path', 'engrave'];

function squareSvg(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#2563eb',
        polylines: [
          {
            closed: true,
            points: [
              { x: 10, y: 10 },
              { x: 30, y: 10 },
              { x: 30, y: 30 },
              { x: 10, y: 30 },
            ],
          },
        ],
      },
    ],
  };
}

function compiledPasses(cutType: CncCutType, cutDirection: CncCutDirection | undefined): unknown {
  const { cutDirection: _defaultDirection, ...baseSettings } = DEFAULT_CNC_LAYER_SETTINGS;
  const cnc =
    cutDirection === undefined
      ? { ...baseSettings, cutType, tabsEnabled: false }
      : { ...baseSettings, cutType, cutDirection, tabsEnabled: false };
  const layer: Layer = { ...createLayer({ id: 'L1', color: '#2563eb' }), cnc };
  const scene: Scene = { objects: [squareSvg()], layers: [layer] };
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error('expected a CNC group');
  return group.passes;
}

describe('inert CNC cut-direction compile contract', () => {
  it.each(INERT_CUT_TYPES)('ignores climb and conventional for %s', (cutType) => {
    const natural = compiledPasses(cutType, undefined);
    expect(compiledPasses(cutType, 'climb')).toEqual(natural);
    expect(compiledPasses(cutType, 'conventional')).toEqual(natural);
  });
});
