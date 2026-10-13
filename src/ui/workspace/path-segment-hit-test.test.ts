import { expect, it } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM, type Scene, type ImportedSvg } from '../../core/scene';
import { hitPathSegment } from './path-segment-hit-test';

it('keeps cached compatibility-path picking aligned with replaced geometry and placement', () => {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'trace',
    source: 'trace.svg',
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
            ],
          },
        ],
      },
    ],
  };
  const scene: Scene = {
    objects: [object],
    groups: [],
    layers: [createLayer({ id: '#000000', color: '#000000' })],
  };
  expect(hitPathSegment(scene, { x: 50, y: 1 }, 0.25)).toMatchObject({
    objectId: 'trace',
    segmentIndex: 0,
    t: 0.5,
  });
  expect(hitPathSegment(scene, { x: 50, y: 10 }, 0.25)).toBeNull();
  const moved = { ...object, transform: { ...IDENTITY_TRANSFORM, y: 100 } };
  expect(hitPathSegment({ ...scene, objects: [moved] }, { x: 50, y: 1 }, 0.25)).toBeNull();
  const edited = {
    ...object,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 50 },
              { x: 100, y: 50 },
            ],
          },
        ],
      },
    ],
  };
  expect(hitPathSegment({ ...scene, objects: [edited] }, { x: 50, y: 50 }, 0.25)).toMatchObject({
    segmentIndex: 0,
    point: { x: 50, y: 50 },
  });
});
