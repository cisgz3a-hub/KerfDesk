import { describe, expect, it } from 'vitest';
import { createRegistrationBox } from '../shapes';
import { createLayer } from './layer';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';
import type { Scene } from './scene';
import {
  registrationJigArtworkInstances,
  registrationJigCopyId,
  registrationJigCopyIdentity,
  registrationJigPartId,
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

  it('round-trips a detached part without treating its unique key as part of the outline', () => {
    const id = registrationJigPartId('source: one/%', 'box: two/%', 'part: three/%');
    expect(registrationJigCopyIdentity(id)).toEqual({
      sourceId: 'source: one/%',
      boxId: 'box: two/%',
    });
    expect(registrationJigCopyIdentity('registration-jig-part:source:box:%broken')).toBeNull();
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

  it.each([1, 2])(
    'keeps the original instance after %i nested parts outlive their copy',
    (depth) => {
      const operation = createLayer({ id: 'artwork', color: '#0000ff' });
      const boxes = [
        createRegistrationBox({ id: 'box-a', widthMm: 40, heightMm: 30 }),
        createRegistrationBox({ id: 'box-b', widthMm: 40, heightMm: 30, x: 50 }),
      ];
      const source = artwork('source: one/%', operation.id);
      let partId = registrationJigCopyId(source.id, 'box-b');
      for (let index = 0; index < depth; index++) {
        partId = registrationJigPartId(partId, 'box-b', `part-${index}`);
      }
      const scene: Scene = {
        objects: [...boxes, source, { ...source, id: partId }],
        layers: [createRegistrationLayer(), operation],
      };
      const expected = [
        { boxId: 'box-a', objectIds: [source.id] },
        { boxId: 'box-b', objectIds: [partId] },
      ];
      expect(instanceSummary(scene)).toEqual(expected);
      expect(instanceSummary(JSON.parse(JSON.stringify(scene)) as Scene)).toEqual(expected);
    },
  );
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
