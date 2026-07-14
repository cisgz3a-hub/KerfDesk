import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type SceneObject } from '../scene';
import { compileJob } from './compile-job';

const object: SceneObject = {
  kind: 'imported-svg',
  id: 'O1',
  source: 'line.svg',
  bounds: { minX: 0, minY: 0, maxX: 5, maxY: 1 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

describe('compileJob vector power mode', () => {
  it('carries an explicit override without inventing one for default layers', () => {
    const baseLayer = createLayer({ id: 'L1', color: '#ff0000' });
    const automatic = compileJob(
      { objects: [object], layers: [baseLayer] },
      DEFAULT_DEVICE_PROFILE,
    );
    const dynamic = compileJob(
      { objects: [object], layers: [{ ...baseLayer, powerMode: 'dynamic' }] },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(automatic.groups[0]).not.toHaveProperty('powerMode');
    expect(dynamic.groups[0]).toMatchObject({ kind: 'cut', powerMode: 'dynamic' });
  });
});
