import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type SceneObject } from '../scene';
import { compileJob } from './compile-job';

describe('compileJob curve boundary', () => {
  it('flattens canonical cubic geometry at machine tolerance', () => {
    const color = '#ff0000';
    const object: SceneObject = {
      kind: 'imported-svg',
      id: 'curve',
      source: 'curve.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color,
          polylines: [
            {
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
              ],
              closed: false,
            },
          ],
          curves: [
            {
              start: { x: 0, y: 0 },
              segments: [
                {
                  kind: 'cubic',
                  control1: { x: 0, y: 10 },
                  control2: { x: 10, y: 10 },
                  to: { x: 10, y: 0 },
                },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    const layer = createLayer({ id: 'curve-layer', color });
    const group = compileJob({ objects: [object], layers: [layer] }, DEFAULT_DEVICE_PROFILE)
      .groups[0];
    expect(group?.kind).toBe('cut');
    if (group?.kind === 'cut') expect(group.segments[0]?.polyline.length).toBeGreaterThan(2);
  });
});
