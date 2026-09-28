// LBG-C13 end to end: the Cut Planner's merge tolerance reaches the emitted
// G-code, and leaves the output byte-identical while it is absent or 0.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_OPTIMIZATION,
  IDENTITY_TRANSFORM,
  type Polyline,
  type Project,
  type ProjectOptimizationSettings,
} from '../../core/scene';
import { deserializeProject } from '../project/deserialize-project';
import { serializeProject } from '../project/serialize-project';
import { emitGcode } from './emit-gcode';

const ARC_DEVICE: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' };

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
      { x, y },
    ],
  };
}

// Two squares whose shared side was drawn 0.02 mm apart, a third sharing a
// side exactly, and an arc-shaped open curve.
const POLYLINES: ReadonlyArray<Polyline> = [
  square(10, 10, 20),
  square(30.02, 10, 20),
  square(10, 30, 20),
  {
    closed: false,
    points: Array.from({ length: 13 }, (_, k) => ({
      x: 70 + 10 * Math.cos((Math.PI * k) / 12),
      y: 20 + 10 * Math.sin((Math.PI * k) / 12),
    })),
  },
];

function project(device: DeviceProfile, optimization: ProjectOptimizationSettings): Project {
  return {
    ...createProject(device),
    optimization,
    scene: {
      layers: [createLayer({ id: 'l', color: '#000000' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'art',
          source: 'art.svg',
          bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
          transform: IDENTITY_TRANSFORM,
          paths: [{ color: '#000000', polylines: POLYLINES }],
        },
      ],
    },
  };
}

describe('overlap merge tolerance in emitted G-code (LBG-C13)', () => {
  it('emits byte-identical G-code with the tolerance absent, 0, or from an older file', () => {
    for (const device of [DEFAULT_DEVICE_PROFILE, ARC_DEVICE]) {
      for (const removeOverlappingLines of [false, true]) {
        const absent = project(device, { ...DEFAULT_PROJECT_OPTIMIZATION, removeOverlappingLines });
        expect('overlapMergeToleranceMm' in absent.optimization).toBe(false);
        const zero = project(device, { ...absent.optimization, overlapMergeToleranceMm: 0 });
        const reloaded = deserializeProject(serializeProject(absent));
        if (reloaded.kind !== 'ok') throw new Error('project did not load');
        const expected = emitGcode(absent).gcode;
        expect(expected).toContain('G1');
        expect(emitGcode(zero).gcode).toBe(expected);
        expect(emitGcode(reloaded.project).gcode).toBe(expected);
      }
    }
  });

  it('cuts the near-coincident side once only with the tolerance on and overlap removal on', () => {
    const burn = (optimization: ProjectOptimizationSettings): string =>
      emitGcode(project(DEFAULT_DEVICE_PROFILE, optimization)).gcode;
    const on = { ...DEFAULT_PROJECT_OPTIMIZATION, removeOverlappingLines: true };
    const exact = burn(on);
    const merged = burn({ ...on, overlapMergeToleranceMm: 0.05 });
    expect(merged).not.toBe(exact);
    expect(merged.split('\n').length).toBeLessThan(exact.split('\n').length);
    // Off, the tolerance does nothing.
    expect(burn({ ...DEFAULT_PROJECT_OPTIMIZATION, overlapMergeToleranceMm: 0.05 })).toBe(
      burn(DEFAULT_PROJECT_OPTIMIZATION),
    );
  });
});
