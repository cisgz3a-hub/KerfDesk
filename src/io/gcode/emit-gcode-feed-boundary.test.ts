import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

describe('emitGcode feed boundary', () => {
  it('does not exceed a positive sub-1 public project feed ceiling', () => {
    const base = createProject({
      ...createProject().device,
      maxFeed: 0.75,
    });
    const scene = addLayer(
      addObject(base.scene, {
        kind: 'imported-svg',
        id: 'slow-line',
        source: 'slow-line.svg',
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        transform: IDENTITY_TRANSFORM,
        paths: [
          {
            color: '#ff0000',
            polylines: [
              {
                points: [
                  { x: 0, y: 0 },
                  { x: 1, y: 1 },
                ],
                closed: false,
              },
            ],
          },
        ],
      }),
      { ...createLayer({ id: 'slow', color: '#ff0000' }), speed: 0.75 },
    );

    const result = emitGcode({ ...base, scene });

    expect(result.preflight.issues).toEqual([]);
    expect(result.gcode).toContain('speed 0.75 mm/min');
    expect(result.gcode).toMatch(/\bF0\.75\b/);
    expect(result.gcode).not.toMatch(/\bF1(?:\D|$)/);
  });
});
