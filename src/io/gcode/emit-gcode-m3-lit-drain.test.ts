// OR-1 (2026-09-25 controller audit) through the shipped composition
// (emitGcode: compileJob, placement, path optimization, strategy): constant-power
// (M3) output never makes the controller drain its planner while the beam is
// still lit mid-job. Covers the Neotronics 4040 profile, whose compile adds
// ADR-239 contour entry runways and controlled laser-off travel, and the
// grbl-compatible dialect. The oracle is grbl-lit-drain-checker.ts.

import { describe, expect, it } from 'vitest';
import { findM3LitPlannerDrains } from '../../__fixtures__/controllers/grbl-lit-drain-checker';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../../core/devices';
import {
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

function square(id: string, color: string, minX: number, minY: number, size: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX, minY, maxX: minX + size, maxY: minY + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: minX, y: minY },
              { x: minX + size, y: minY },
              { x: minX + size, y: minY + size },
              { x: minX, y: minY + size },
              { x: minX, y: minY },
            ],
          },
        ],
      },
    ],
  };
}

function layer(id: string, color: string, patch: Partial<Layer>): Layer {
  return { ...createLayer({ id, color }), power: 60, speed: 1200, ...patch };
}

// A two-pass score, then a cut on the SAME contour that turns air on (the cut
// starts where the score's last burn ended), then a mark elsewhere without air.
function lineProject(device: DeviceProfile): Project {
  const base = createProject({ ...device, homing: { enabled: false, direction: 'front-left' } });
  return {
    ...base,
    scene: {
      ...EMPTY_SCENE,
      layers: [
        layer('score', '#ff0000', { passes: 2, airAssist: false }),
        layer('cut', '#00ff00', { passes: 1, airAssist: true }),
        layer('mark', '#ff00ff', { passes: 1, airAssist: false }),
      ],
      objects: [
        square('A', '#ff0000', 20, 20, 30),
        square('C', '#00ff00', 20, 20, 30),
        square('D', '#ff00ff', 70, 20, 10),
      ],
    },
  };
}

// The same with a scanline fill, which the compile orders among the cuts.
function fillProject(device: DeviceProfile): Project {
  const project = lineProject(device);
  return {
    ...project,
    scene: {
      ...project.scene,
      layers: [
        ...project.scene.layers,
        layer('fill', '#0000ff', { mode: 'fill', airAssist: false }),
      ],
      objects: [...project.scene.objects, square('B', '#0000ff', 90, 20, 10)],
    },
  };
}

describe('OR-1 through emitGcode: no mid-job drain with an M3 beam lit', () => {
  it.each([
    ['Neotronics 4040 (M3 cut, controlled travel)', NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE],
    [
      'grbl-compatible dialect (M3 everywhere)',
      { ...DEFAULT_DEVICE_PROFILE, gcodeDialect: { dialectId: 'grbl-compatible' as const } },
    ],
  ])('%s', (_label, profile) => {
    const device: DeviceProfile = { ...profile, airAssistCommand: 'M8' };
    for (const project of [lineProject(device), fillProject(device)]) {
      const { gcode, preflight } = emitGcode(project);
      expect(preflight.ok).toBe(true);
      expect(gcode).toMatch(/^M8$/m);
      expect(gcode).toMatch(/^M9$/m);
      expect(findM3LitPlannerDrains(gcode)).toEqual([]);
    }
  });
});
