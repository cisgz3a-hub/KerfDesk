import { describe, expect, it } from 'vitest';
import { createRegistrationBox } from '../shapes';
import { createLayer } from './layer';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';
import type { Scene } from './scene';
import {
  registrationJigArtworkInstances,
  registrationJigCopyId,
  registrationJigCopyIdentity,
} from './registration-jig-artwork';
import { createRegistrationLayer } from './registration-layer';

describe('registration jig artwork identity', () => {
  it('round-trips arbitrary source and outline ids', () => {
    const id = registrationJigCopyId('source: one/%', 'box: two/%');
    expect(registrationJigCopyIdentity(id)).toEqual({
      sourceId: 'source: one/%',
      boxId: 'box: two/%',
    });
  });

  it('groups a multi-object layout by physical outline order', () => {
    const operation = createLayer({ id: 'artwork', color: '#0000ff' });
    const boxes = [
      createRegistrationBox({ id: 'box-a', widthMm: 40, heightMm: 30 }),
      createRegistrationBox({ id: 'box-b', widthMm: 40, heightMm: 30, x: 50 }),
      createRegistrationBox({ id: 'box-c', widthMm: 40, heightMm: 30, x: 100 }),
    ];
    const sourceLeft = artwork('left', operation.id);
    const sourceRight = artwork('right', operation.id);
    const objects = [
      ...boxes,
      sourceLeft,
      sourceRight,
      { ...sourceLeft, id: registrationJigCopyId(sourceLeft.id, 'box-b') },
      { ...sourceRight, id: registrationJigCopyId(sourceRight.id, 'box-b') },
      { ...sourceLeft, id: registrationJigCopyId(sourceLeft.id, 'box-c') },
      { ...sourceRight, id: registrationJigCopyId(sourceRight.id, 'box-c') },
    ];

    const scene: Scene = { objects, layers: [createRegistrationLayer(), operation] };
    expect(instanceSummary(scene)).toEqual([
      { boxId: 'box-a', objectIds: ['left', 'right'] },
      {
        boxId: 'box-b',
        objectIds: [
          registrationJigCopyId('left', 'box-b'),
          registrationJigCopyId('right', 'box-b'),
        ],
      },
      {
        boxId: 'box-c',
        objectIds: [
          registrationJigCopyId('left', 'box-c'),
          registrationJigCopyId('right', 'box-c'),
        ],
      },
    ]);
    expect(instanceSummary(JSON.parse(JSON.stringify(scene)) as Scene)).toEqual(
      instanceSummary(scene),
    );
  });
});

function instanceSummary(scene: Scene) {
  return registrationJigArtworkInstances(scene).map((instance) => ({
    boxId: instance.boxId,
    objectIds: instance.objects.map((object) => object.id),
  }));
}

function artwork(id: string, operationId: string): SceneObject {
  return {
    kind: 'shape',
    id,
    color: '#0000ff',
    operationIds: [operationId],
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    spec: { kind: 'rect', widthMm: 10, heightMm: 5, cornerRadiusMm: 0 },
  };
}
