import { describe, expect, it } from 'vitest';
import {
  testAuthoringRelief,
  testLinkedReliefDocument,
} from '../../../__fixtures__/relief-authoring';
import {
  createLayer,
  createProject,
  createRegistrationLayer,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
import {
  createRegistrationBox,
  createRegistrationCircle,
} from '../../../core/shapes/registration-box';
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

  it('closes over overlapping groups whatever their order', () => {
    const { scene } = project(
      [outline, square('inside', 130, 110), square('a', 5, 5), square('b', 20, 5)],
      [
        // Seen first, but joins the jig only through the second group.
        { id: 'g1', name: 'First', objectIds: ['b', 'a'] },
        { id: 'g2', name: 'Second', objectIds: ['inside', 'a'] },
      ],
    );
    expect([...jigBackgroundIds(scene)]).toEqual([]);
  });

  it('shows hidden artwork that shares a mask with jig artwork, so editing it is safe', () => {
    const raster = (id: string, x: number): SceneObject => ({
      kind: 'raster-image',
      id,
      source: `${id}.png`,
      pixelWidth: 10,
      pixelHeight: 10,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: { ...IDENTITY_TRANSFORM, x, y: 110 },
      color: '#123456',
      dither: 'threshold',
      linesPerMm: 10,
      imageMaskId: 'mask',
    });
    const { scene } = project([
      outline,
      raster('on-jig', 130),
      raster('off-jig', 300),
      square('mask', 5, 5),
      square('unrelated', 300, 5),
    ]);
    expect([...jigBackgroundIds(scene)]).toEqual(['unrelated']);
  });

  it('shows a hidden retained relief linked to jig artwork it was authored from', () => {
    const relief = testAuthoringRelief();
    const { scene } = project([
      outline,
      // testLinkedReliefDocument links its boundary to the object with this id.
      square('boundary', 130, 110),
      {
        ...relief,
        transform: { ...relief.transform, x: 300, y: 300 },
        reliefAuthoring: testLinkedReliefDocument(relief),
      },
      square('unrelated', 300, 5),
    ]);
    expect([...jigBackgroundIds(scene)]).toEqual(['unrelated']);
  });

  it("tests the outline's own shape, not its bounding box", () => {
    const circle = createRegistrationCircle({ diameterMm: 40, x: 100, y: 100, id: 'circle' });
    const round = project([
      circle,
      // In the bounding box's corner, outside the circle.
      square('corner', 97, 97),
      square('centre', 115, 115),
    ]);
    expect([...jigBackgroundIds(round.scene)]).toEqual(['corner']);
    // Turned a quarter about its corner, the 80 x 40 outline covers x 100..140, y 120..200.
    const turned = {
      ...outline,
      transform: { ...outline.transform, x: 140, y: 120, rotationDeg: 90 },
    };
    const rotated = project([turned, square('under', 115, 150), square('beside', 150, 105)]);
    expect([...jigBackgroundIds(rotated.scene)]).toEqual(['beside']);
  });

  it('measures artwork size in a rotated outline’s own frame', () => {
    // An 80 x 40 outline turned 45 degrees: its bounding box is about 85 x 85 mm.
    const tilted = {
      ...outline,
      transform: { ...outline.transform, x: 200, y: 200, rotationDeg: 45 },
    };
    const centre = { x: 200 + 20 * Math.SQRT1_2, y: 200 + 60 * Math.SQRT1_2 };
    const sized = (id: string, size: number): SceneObject => ({
      ...createRectangle({
        id,
        color: '#0000ff',
        spec: { widthMm: size, heightMm: size, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: centre.x - size / 2, y: centre.y - size / 2 },
      }),
      operationIds: ['art'],
    });
    const { scene } = project([tilted, sized('small', 10), sized('big', 80)]);
    expect([...jigBackgroundIds(scene)]).toEqual(['big']);
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
