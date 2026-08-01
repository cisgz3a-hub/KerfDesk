import { describe, expect, it, vi } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode';

import { prepareLargeJob } from './large-job-preparation';

describe('prepareLargeJob', () => {
  it('derives preview and ETA from one prepared output', () => {
    const base = createProject();
    const project = {
      ...base,
      scene: addLayer(
        addObject(base.scene, {
          kind: 'imported-svg' as const,
          id: 'line',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        }),
        createLayer({ id: 'cut', color: '#ff0000' }),
      ),
    };

    const compile = vi.fn(prepareOutput);
    const result = prepareLargeJob(project, {}, compile);

    expect(compile).toHaveBeenCalledTimes(1);
    expect(result.toolpath.totalLength).toBeGreaterThan(0);
    expect(result.estimate.kind).toBe('estimated');
  });
});
