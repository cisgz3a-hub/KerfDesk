import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  createRegistrationLayer,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
import { createRegistrationBox } from '../../../core/shapes/registration-box';
import { jigBackgroundIds, jigViewProject, withJigBackground } from './jig-editor-scope';

function square(id: string, x: number, y: number): SceneObject {
  return {
    ...createRectangle({
      id,
      color: '#0000ff',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x, y },
    }),
    operationIds: ['art'],
  };
}

const outline = createRegistrationBox({ widthMm: 80, heightMm: 40, x: 100, y: 100, id: 'box' });

function project(
  objects: ReadonlyArray<SceneObject>,
  groups?: Project['scene']['groups'],
): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      objects,
      layers: [
        createRegistrationLayer(),
        createLayer({ id: 'art', name: 'Art', color: '#0000ff' }),
      ],
      ...(groups === undefined ? {} : { groups }),
    },
  };
}

describe('jig editor scope', () => {
  it('hides every main-canvas object before a jig exists', () => {
    const { scene } = project([square('a', 5, 5), square('b', 135, 115)]);
    expect([...jigBackgroundIds(scene)].sort()).toEqual(['a', 'b']);
  });

  it('shows outlines, artwork centred on them and linked copies, and hides the rest', () => {
    const copy: SceneObject = {
      ...square('copy', 300, 300),
      registrationJig: {
        objectId: 'copy',
        boxId: 'box',
        ancestors: [{ sourceId: 'inside', kind: 'copy' }],
      },
    };
    const { scene } = project([
      outline,
      square('inside', 130, 110),
      square('outside', 5, 5),
      // Overlaps the outline's edge, but its centre is outside it.
      square('edge', 176, 100),
      // Centred on the outline but larger: a main-canvas design covering the jig.
      {
        ...createRectangle({
          id: 'sign',
          color: '#0000ff',
          spec: { widthMm: 140, heightMm: 90, cornerRadiusMm: 0 },
          transform: { ...IDENTITY_TRANSFORM, x: 70, y: 75 },
        }),
        operationIds: ['art'],
      },
      copy,
    ]);
    expect([...jigBackgroundIds(scene)].sort()).toEqual(['edge', 'outside', 'sign']);
  });

  it('keeps a group whole when one member belongs to the jig', () => {
    const { scene } = project(
      [outline, square('inside', 130, 110), square('mate', 5, 5), square('alone', 300, 5)],
      [{ id: 'g', name: 'Group', objectIds: ['inside', 'mate'] }],
    );
    expect([...jigBackgroundIds(scene)]).toEqual(['alone']);
  });

  it('views the draft without the background and folds edits back in place', () => {
    const draft = project([square('main', 5, 5), outline, square('inside', 130, 110)]);
    const background = new Set(['main']);
    const view = jigViewProject(draft, background);
    expect(view.scene.objects.map((object) => object.id)).toEqual(['box', 'inside']);
    expect(jigViewProject(draft, new Set())).toBe(draft);

    const moved = view.scene.objects.map((object) =>
      object.id === 'inside'
        ? { ...object, transform: { ...object.transform, x: object.transform.x + 1 } }
        : object,
    );
    const edited = {
      ...view,
      scene: { ...view.scene, objects: [...moved, square('added', 120, 105)] },
    };
    const merged = withJigBackground(draft, edited, background);
    expect(merged.scene.objects.map((object) => object.id)).toEqual([
      'main',
      'box',
      'inside',
      'added',
    ]);
    expect(merged.scene.objects[0]).toBe(draft.scene.objects[0]);
    expect(merged.scene.objects[2]?.transform.x).toBe(131);

    const deleted = { ...view, scene: { ...view.scene, objects: [outline] } };
    expect(
      withJigBackground(draft, deleted, background).scene.objects.map((object) => object.id),
    ).toEqual(['main', 'box']);
  });
});
