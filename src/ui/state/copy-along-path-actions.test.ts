// Store behaviour of Copy Along Path (LightBurn gap LBG-T09): the copies, the
// guide, the selection, the undo step and the notices.
import { beforeEach, describe, expect, it } from 'vitest';
import { transformedBBox } from '../../core/scene/hit-test';
import { createLayer, type Layer } from '../../core/scene/layer';
import { createProject, type Project } from '../../core/scene/project';
import type { SceneGroup } from '../../core/scene/scene';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type SceneObject,
} from '../../core/scene/scene-object';
import type { CopyAlongPathRequest } from './copy-along-path-plan';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const REQUEST: CopyAlongPathRequest = {
  mode: 'count',
  count: 3,
  spacingMm: 10,
  startOffsetMm: 0,
  endOffsetMm: 0,
  rotateCopies: true,
  keepOriginal: true,
};

function poly(points: ReadonlyArray<readonly [number, number]>, closed = false): Polyline {
  return { closed, points: points.map(([x, y]) => ({ x, y })) };
}

function svg(id: string, polylines: ReadonlyArray<Polyline>, x = 0, y = 0): ImportedSvg {
  const xs = polylines.flatMap((line) => line.points.map((point) => point.x));
  const ys = polylines.flatMap((line) => line.points.map((point) => point.y));
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines }],
  };
}

// A 10 × 4 mm box at (200, 200), and a 100 mm guide along y = 50.
const BOX = svg(
  'box',
  [
    poly(
      [
        [0, 0],
        [10, 0],
        [10, 4],
        [0, 4],
        [0, 0],
      ],
      true,
    ),
  ],
  200,
  200,
);
const GUIDE = svg('guide', [
  poly([
    [0, 50],
    [100, 50],
  ]),
]);
// Two separate triangles: artwork, never a guide.
const LOGO = svg('logo', [
  poly(
    [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 0],
    ],
    true,
  ),
  poly(
    [
      [10, 0],
      [15, 0],
      [15, 5],
      [10, 0],
    ],
    true,
  ),
]);
const SQUARE_GUIDE = svg('ring', [
  poly(
    [
      [0, 0],
      [40, 0],
      [40, 40],
      [0, 40],
      [0, 0],
    ],
    true,
  ),
]);

function layer(id: string): Layer {
  return createLayer({ id, name: id, color: '#000000' });
}

function load(
  objects: ReadonlyArray<SceneObject>,
  selected: ReadonlyArray<string>,
  groups: ReadonlyArray<SceneGroup> = [],
): Project {
  const project = { ...createProject(), scene: { objects, layers: [layer('cut')], groups } };
  useStore.setState({
    project,
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    dirty: false,
  });
  return project;
}

function project(): Project {
  return useStore.getState().project;
}

function selection(): ReadonlyArray<string> {
  const state = useStore.getState();
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
}

function copies(): ReadonlyArray<SceneObject> {
  const ids = new Set(selection());
  return project().scene.objects.filter((object) => ids.has(object.id));
}

function centre(object: SceneObject): { readonly x: number; readonly y: number } {
  const box = transformedBBox(object);
  return { x: round((box.minX + box.maxX) / 2), y: round((box.minY + box.maxY) / 2) };
}

function round(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function lastToast(): { readonly message: string; readonly variant: string } | undefined {
  const toast = useToastStore.getState().toasts.at(-1);
  return toast === undefined ? undefined : { message: toast.message, variant: toast.variant };
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Copy Along Path', () => {
  it('places copies on the guide, keeps the original and the guide, and selects the copies', () => {
    const before = load([BOX, GUIDE], ['box', 'guide']);

    expect(useStore.getState().copyAlongPath(REQUEST)).toBe(true);

    const objects = project().scene.objects;
    expect(objects.slice(0, 2)).toEqual([BOX, GUIDE]);
    expect(objects).toHaveLength(5);
    expect(copies().map(centre)).toEqual([
      { x: 0, y: 50 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ]);
    expect(copies().every((copy) => copy.operationIds?.[0] === 'cut')).toBe(true);
    expect(new Set(copies().map((copy) => copy.id)).size).toBe(3);
    expect(copies().some((copy) => copy.id === 'box')).toBe(false);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().dirty).toBe(true);
    expect(lastToast()).toEqual({
      message: 'Placed 3 copies along the guide path.',
      variant: 'success',
    });

    useStore.getState().undo();
    expect(project()).toBe(before);
  });

  it('turns each copy with a closed guide and does not double the start', () => {
    load([BOX, SQUARE_GUIDE], ['box', 'ring']);

    useStore.getState().copyAlongPath({ ...REQUEST, count: 4, startOffsetMm: 20 });

    expect(copies().map((copy) => copy.transform.rotationDeg)).toEqual([0, 90, 180, 270]);
    expect(copies().map(centre)).toEqual([
      { x: 20, y: 0 },
      { x: 40, y: 20 },
      { x: 20, y: 40 },
      { x: 0, y: 20 },
    ]);
  });

  it('replaces the original with the copies when asked, in one undo step', () => {
    const before = load([BOX, GUIDE], ['box', 'guide']);

    useStore.getState().copyAlongPath({ ...REQUEST, count: 2, keepOriginal: false });

    const ids = project().scene.objects.map((object) => object.id);
    expect(ids).not.toContain('box');
    expect(ids).toContain('guide');
    expect(ids).toHaveLength(3);
    expect(project().scene.layers.map((entry) => entry.id)).toEqual(['cut']);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(lastToast()?.message).toBe(
      'Placed 2 copies along the guide path in place of the original.',
    );
  });

  it('uses the guide picked in the dialog instead of the top-most path', () => {
    load([GUIDE, BOX], ['guide', 'box']);

    useStore.getState().copyAlongPath({ ...REQUEST, count: 2, guideId: 'guide' });

    expect(copies().map(centre)).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);
  });

  it('gives each copy of a group its own group', () => {
    const lid = { ...BOX, id: 'lid', transform: { ...BOX.transform, y: 210 } };
    const group: SceneGroup = { id: 'g', name: 'Group 1', objectIds: ['box', 'lid'] };
    load([BOX, lid, GUIDE], ['box', 'lid', 'guide'], [group]);

    useStore.getState().copyAlongPath({ ...REQUEST, count: 2 });

    const groups = project().scene.groups ?? [];
    expect(groups).toHaveLength(3);
    const copyIds = new Set(copies().map((copy) => copy.id));
    for (const copied of groups.slice(1)) {
      expect(copied.objectIds).toHaveLength(2);
      expect(copied.objectIds.every((id) => copyIds.has(id))).toBe(true);
    }
  });

  it('explains a selection it cannot use and changes nothing', () => {
    const cases: ReadonlyArray<
      readonly [
        ReadonlyArray<SceneObject>,
        ReadonlyArray<string>,
        Partial<CopyAlongPathRequest>,
        string,
      ]
    > = [
      [[BOX], ['box'], {}, 'Select the artwork to copy as well as the guide path.'],
      [
        [BOX, GUIDE],
        ['box', 'guide'],
        { startOffsetMm: 60, endOffsetMm: 50 },
        'The start and end offsets leave no room on the 100 mm guide path.',
      ],
      [
        [BOX, GUIDE],
        ['box', 'guide'],
        { mode: 'spacing', spacingMm: 0 },
        'The copies would all land in one place. Set a spacing above 0 mm.',
      ],
      [
        [LOGO, svg('dot', [poly([[5, 5]])])],
        ['logo', 'dot'],
        {},
        'The guide path has no length to copy along.',
      ],
      [
        [LOGO, { ...LOGO, id: 'badge' }],
        ['logo', 'badge'],
        {},
        'Copy Along Path needs a guide: select the artwork and one open or closed path to copy it along. Text and barcodes are never the guide.',
      ],
    ];
    for (const [objects, selected, patch, message] of cases) {
      const before = load(objects, selected);
      expect(useStore.getState().copyAlongPath({ ...REQUEST, ...patch })).toBe(false);
      expect(project()).toBe(before);
      expect(useStore.getState().undoStack).toEqual([]);
      expect(lastToast()).toEqual({ message, variant: 'warning' });
    }
  });
});
