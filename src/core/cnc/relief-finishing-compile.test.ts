// H.8 compile integration: a relief layer with a finishing bit produces the
// roughing group AND a relief-finish group cut with that bit, in that
// order, both before any profile work; without one, roughing stays alone.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type Layer,
  type ReliefObject,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const RELIEF_COLOR = '#a0522d';

// A tilted triangle mesh — enough surface for a real heightmap.
function relief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'model.stl',
    meshPositions: [0, 0, 0, 40, 0, 3, 0, 40, 6],
    targetWidthMm: 40,
    reliefDepthMm: 5,
    emptyCells: 'floor',
    color: RELIEF_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
  };
}

function reliefLayer(cnc: Partial<CncLayerSettings>): Layer {
  return {
    ...createLayer({ id: RELIEF_COLOR, color: RELIEF_COLOR }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave', ...cnc },
  };
}

function compile(cnc: Partial<CncLayerSettings>) {
  const scene: Scene = { objects: [relief()], layers: [reliefLayer(cnc)] };
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
}

describe('relief finishing compile (H.8)', () => {
  it('adds a relief-finish group with the finishing bit after roughing', () => {
    const job = compile({ reliefFinishToolId: 'bn-3175' });
    const cutTypes = job.groups.map((group) => (group.kind === 'cnc' ? group.cutType : ''));
    expect(cutTypes).toEqual(['relief-rough', 'relief-finish']);
    const finish = job.groups[1];
    if (finish?.kind !== 'cnc') throw new Error('finish group missing');
    expect(finish.toolId).toBe('bn-3175');
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
});
