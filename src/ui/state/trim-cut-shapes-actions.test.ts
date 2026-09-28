// Store behaviour of Trim Shapes and Cut Shapes (LightBurn gap LBG-T04 and
// LBG-T08): what a click or the command changes, the selection, the undo step
// and the notice.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Project,
  type RasterImage,
  type Scene,
  type SceneObject,
  type ShapeObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

type Point = readonly [number, number];

function poly(points: ReadonlyArray<Point>, closed = false): Polyline {
  return { closed, points: points.map(([x, y]) => ({ x, y })) };
}

function square(x: number, y: number, size: number): Polyline {
  return poly(
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
    ],
    true,
  );
}

function art(
  id: string,
  polylines: ReadonlyArray<Polyline>,
  patch: Partial<ImportedSvg> = {},
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines }],
    ...patch,
  };
}

function layer(id: string, patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id, name: id, color: '#000000' }), ...patch };
}

function load(
  objects: ReadonlyArray<SceneObject>,
  selected: ReadonlyArray<string> = [],
  scene: Partial<Scene> = {},
): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: { objects, layers: [layer('cut'), layer('engrave')], groups: [], ...scene },
    },
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    dirty: false,
  });
}

function project(): Project {
  return useStore.getState().project;
}

function objectById(id: string): SceneObject {
  const object = project().scene.objects.find((entry) => entry.id === id);
  if (object === undefined) throw new Error(`object ${id} missing`);
  return object;
}

function pointsOf(id: string): ReadonlyArray<ReadonlyArray<Point>> {
  const object = objectById(id);
  if (!('paths' in object)) return [];
  return object.paths.flatMap((path) =>
    path.polylines.map((polyline) => polyline.points.map((point) => [point.x, point.y] as const)),
  );
}

function selection(): ReadonlyArray<string> {
  const state = useStore.getState();
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
}

function lastToast(): { readonly message: string; readonly variant: string } | undefined {
  const toast = useToastStore.getState().toasts.at(-1);
  return toast === undefined ? undefined : { message: toast.message, variant: toast.variant };
}

const RAIL = art('rail', [
  poly([
    [0, 10],
    [30, 10],
  ]),
]);
const POSTS = [
  art('left', [
    poly([
      [10, 0],
      [10, 20],
    ]),
  ]),
  art('right', [
    poly([
      [20, 0],
      [20, 20],
    ]),
  ]),
];

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Trim Shapes', () => {
  it('deletes the clicked stretch in one undo step and keeps the object', () => {
    load([RAIL, ...POSTS]);
    const before = project();

    expect(useStore.getState().trimShapeAt({ x: 15, y: 10.3 }, 0.5)).toBe(true);

    expect(pointsOf('rail')).toEqual([
      [
        [0, 10],
        [10, 10],
      ],
      [
        [20, 10],
        [30, 10],
      ],
    ]);
    expect(objectById('rail')).toMatchObject({ kind: 'imported-svg', operationIds: ['cut'] });
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().dirty).toBe(true);
    useStore.getState().undo();
    expect(project()).toBe(before);
  });

  it('changes nothing when no outline is under the pointer', () => {
    load([RAIL, ...POSTS]);
    const before = project();
    expect(useStore.getState().trimShapeAt({ x: 15, y: 25 }, 0.5)).toBe(false);
    expect(project()).toBe(before);
    expect(useStore.getState().undoStack).toEqual([]);
  });

  it('deletes an outline that crosses nothing, and its selection', () => {
    load([RAIL], ['rail']);
    const before = project();
    useStore.getState().trimShapeAt({ x: 15, y: 10 }, 0.5);
    expect(project().scene.objects).toEqual([]);
    expect(selection()).toEqual([]);
    useStore.getState().undo();
    expect(project()).toBe(before);
  });

  it('turns a trimmed rectangle into a plain path in place and says so', () => {
    const rotated = { ...IDENTITY_TRANSFORM, x: 50, y: 50, rotationDeg: 90 };
    const rectangle = createRectangle({
      id: 'box',
      color: '#000000',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: rotated,
    });
    // The rectangle spans x 40..50, y 50..70 on the bed; the line crosses it at y = 60.
    load([
      rectangle,
      art('line', [
        poly([
          [30, 60],
          [60, 60],
        ]),
      ]),
    ]);

    expect(useStore.getState().trimShapeAt({ x: 50, y: 55 }, 0.5)).toBe(true);

    const trimmed = objectById('box');
    expect(trimmed).toMatchObject({ kind: 'imported-svg', transform: rotated });
    expect('paths' in trimmed && trimmed.paths[0]?.curves?.[0]?.closed).toBe(false);
    expect(lastToast()).toEqual({
      message:
        'The trimmed rectangle is now a plain path, so its rectangle settings no longer apply. Undo restores it.',
      variant: 'info',
    });
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('keeps a drawn line a drawn line while one piece is left', () => {
    const line: ShapeObject = {
      kind: 'shape',
      id: 'pen',
      spec: {
        kind: 'polyline',
        points: [
          { x: 0, y: 10 },
          { x: 30, y: 10 },
        ],
        closed: false,
      },
      color: '#000000',
      bounds: { minX: 0, minY: 10, maxX: 30, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      operationIds: ['cut'],
      paths: [
        {
          color: '#000000',
          polylines: [
            poly([
              [0, 10],
              [30, 10],
            ]),
          ],
        },
      ],
    };
    load([line, POSTS[0] as ImportedSvg]);
    useStore.getState().trimShapeAt({ x: 5, y: 10 }, 0.5);
    expect(objectById('pen')).toMatchObject({
      kind: 'shape',
      spec: {
        kind: 'polyline',
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ],
        closed: false,
      },
    });
    expect(lastToast()).toBeUndefined();
  });

  it('leaves locked artwork alone', () => {
    load([{ ...RAIL, locked: true }, ...POSTS]);
    expect(useStore.getState().trimShapeAt({ x: 15, y: 10 }, 0.5)).toBe(false);
  });

  it('keeps placed tabs on the other contours of a trimmed object', () => {
    const twoLines = art(
      'pair',
      [
        poly([
          [0, 10],
          [30, 10],
        ]),
        poly([
          [0, 30],
          [30, 30],
        ]),
      ],
      {
        laserTabAnchors: [
          { layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.5 },
          { layerColor: '#000000', pathIndex: 0, polylineIndex: 1, pathT: 0.25 },
        ],
      },
    );
    load([twoLines, ...POSTS]);
    useStore.getState().trimShapeAt({ x: 15, y: 10 }, 0.5);
    expect(objectById('pair').laserTabAnchors).toEqual([
      { layerColor: '#000000', pathIndex: 0, polylineIndex: 2, pathT: 0.25 },
    ]);
  });
});

describe('Cut Shapes', () => {
  it('replaces each cut shape with its pieces, removes the cutter and selects the pieces', () => {
    load(
      [
        art('back', [square(0, 0, 20)]),
        art('other', [square(100, 0, 5)]),
        art('front', [square(10, 10, 20)], { operationIds: ['engrave'] }),
      ],
      ['back', 'front'],
      {
        artworkOrder: ['front', 'back', 'other'],
        groups: [{ id: 'g', name: 'G', objectIds: ['back', 'other'] }],
      },
    );
    const before = project();

    expect(useStore.getState().cutSelectedShapes()).toBe(true);

    const scene = project().scene;
    expect(scene.objects.map((object) => object.id)).toEqual([
      'back-outside',
      'back-inside',
      'other',
    ]);
    expect(scene.artworkOrder).toEqual(['back-outside', 'back-inside', 'other']);
    expect(scene.groups).toEqual([]);
    expect(objectById('back-inside').operationIds).toEqual(['cut']);
    expect(scene.layers.map((entry) => entry.id)).toEqual(['cut']);
    expect(selection()).toEqual(['back-outside', 'back-inside']);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(lastToast()).toEqual({ message: 'Cut 1 shape into 2 pieces.', variant: 'success' });
    useStore.getState().undo();
    expect(project()).toBe(before);
  });

  it('says how many selected objects it left alone', () => {
    const image = {
      kind: 'raster-image',
      id: 'photo',
      source: 'photo.png',
      pixelWidth: 1,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
      color: '#808080',
      dither: 'threshold',
      linesPerMm: 10,
    } satisfies RasterImage;
    load(
      [art('back', [square(0, 0, 20)]), image, art('front', [square(10, 10, 20)])],
      ['back', 'photo', 'front'],
    );
    useStore.getState().cutSelectedShapes();
    expect(lastToast()?.message).toBe(
      'Cut 1 shape into 2 pieces. 1 other selected object was left as it was.',
    );
  });

  it('explains a selection it cannot cut and changes nothing', () => {
    load(
      [
        art('a', [
          poly([
            [0, 0],
            [10, 10],
          ]),
        ]),
        art('b', [
          poly([
            [0, 10],
            [10, 0],
          ]),
        ]),
      ],
      ['a', 'b'],
    );
    const before = project();
    expect(useStore.getState().cutSelectedShapes()).toBe(false);
    expect(project()).toBe(before);
    expect(useStore.getState().undoStack).toEqual([]);
    expect(lastToast()).toEqual({
      message:
        'Cut Shapes needs a closed shape to cut with, and none of the selected shapes is closed. The top-most selected closed shape is the cutter.',
      variant: 'warning',
    });
  });
});
