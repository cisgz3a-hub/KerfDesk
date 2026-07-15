import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type SceneObject } from '../scene';
import { compileJob } from './compile-job';

function artwork(id: string, operationId: string, x: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    operationIds: [operationId],
    bounds: { minX: x, minY: 0, maxX: x + 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x, y: 0 },
              { x: x + 1, y: 0 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
}

describe('compileJob artwork priority', () => {
  it('runs artwork by priority and operations within each artwork', () => {
    const firstLayer = createLayer({ id: 'first-op', color: '#2563eb' });
    const secondLayer = createLayer({ id: 'second-op', color: '#dc2626' });
    const first = artwork('first', firstLayer.id, 0);
    const second = artwork('second', secondLayer.id, 10);

    const job = compileJob(
      {
        objects: [first, second],
        layers: [firstLayer, secondLayer],
        artworkOrder: ['second', 'first'],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(job.groups.map((group) => [group.sourceObjectId, group.layerId])).toEqual([
      ['second', 'second-op'],
      ['first', 'first-op'],
    ]);
  });

  it('keeps a unified operation as one machining unit at its earliest artwork priority', () => {
    const shared = createLayer({ id: 'shared', color: '#2563eb' });
    const first = artwork('first', shared.id, 0);
    const second = artwork('second', shared.id, 10);

    const job = compileJob(
      { objects: [first, second], layers: [shared], artworkOrder: ['second', 'first'] },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(job.groups).toHaveLength(1);
    expect(job.groups[0]?.sourceObjectId).toBe('second');
  });
});
