import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

const sampleObject: SceneObject = {
  kind: 'imported-svg',
  id: 'O1',
  source: 'a.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 1, y: 1 },
            { x: 9, y: 9 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

describe('emitGcode', () => {
  it('returns gcode and a passing preflight for a well-formed project', () => {
    const base = createProject();
    const project = {
      ...base,
      scene: addLayer(
        addObject(base.scene, sampleObject),
        createLayer({ id: 'L1', color: '#ff0000' }),
      ),
    };
    const { gcode, preflight } = emitGcode(project);
    expect(preflight.ok).toBe(true);
    expect(gcode).toContain('G21');
    expect(gcode).toContain('G1');
  });

  it('returns a failing preflight when the project has no output layers', () => {
    const project = createProject();
    const { preflight } = emitGcode(project);
    expect(preflight.ok).toBe(false);
    expect(preflight.issues.some((i) => i.code === 'no-output-layer')).toBe(true);
  });
});
