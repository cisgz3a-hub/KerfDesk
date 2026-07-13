import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const dev = DEFAULT_DEVICE_PROFILE;
const config = DEFAULT_CNC_MACHINE_CONFIG;

function squareObject(size: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'square.svg',
    bounds: { minX: 50, minY: 50, maxX: 50 + size, maxY: 50 + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 50, y: 50 },
              { x: 50 + size, y: 50 },
              { x: 50 + size, y: 50 + size },
              { x: 50, y: 50 + size },
            ],
          },
        ],
      },
    ],
  };
}

function sceneWith(settings: Partial<CncLayerSettings>, size: number): Scene {
  const layer: Layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...settings },
  };
  return { layers: [layer], objects: [squareObject(size)] };
}

describe('compileCncJob pocket strategies', () => {
  it('compiles verified adaptive roughing with native helix and cleanup contours', () => {
    const scene = sceneWith(
      {
        cutType: 'pocket',
        pocketStrategy: 'adaptive',
        adaptiveOptimalLoadMm: 0.4,
        depthMm: 2,
        depthPerPassMm: 2,
      },
      20,
    );
    const job = compileCncJob(scene, dev, config);
    expect(job.groups).toHaveLength(1);
    const group = job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected a CNC group');
    expect(group.passes[0]?.kind).toBe('helical-contour');
    expect(group.passes.some((pass) => pass.kind === 'contour')).toBe(true);
    const gcode = cncGrblStrategy.emit(job, dev);
    expect(gcode).toMatch(/^G3 .*I-.*J0\.000/m);
    expect(gcode).toBe(cncGrblStrategy.emit(compileCncJob(scene, dev, config), dev));
  });

  it('runs a larger pocket rougher before a smaller rest-machining bit', () => {
    const job = compileCncJob(
      sceneWith(
        {
          cutType: 'pocket',
          toolId: 'em-1588',
          pocketRoughToolId: 'em-6350',
          depthMm: 2,
          depthPerPassMm: 2,
        },
        30,
      ),
      dev,
      config,
    );
    expect(job.groups).toHaveLength(2);
    const rough = job.groups[0];
    const rest = job.groups[1];
    if (rough?.kind !== 'cnc' || rest?.kind !== 'cnc') throw new Error('expected CNC groups');
    expect(rough.toolId).toBe('em-6350');
    expect(rest.toolId).toBe('em-1588');
    expect(rough.passes.length).toBeGreaterThan(rest.passes.length);
    expect(rest.passes.length).toBeGreaterThan(0);
    const gcode = cncGrblStrategy.emit(job, dev);
    expect(gcode.indexOf('tool 6.350 mm')).toBeLessThan(gcode.indexOf('tool 1.588 mm'));
    expect(gcode.match(/^M0$/gm)).toHaveLength(1);
  });
});
