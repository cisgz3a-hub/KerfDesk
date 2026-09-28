// Store behaviour of Warp and Deform (LightBurn gap LBG-T06): one undo step,
// bindings kept, text and drawn shapes converted, images left alone, and the
// notice that says so.
import { beforeEach, describe, expect, it } from 'vitest';
import { initialWarpDeformHandles } from '../../core/geometry/warp-deform-map';
import { createLayer, type Layer } from '../../core/scene/layer';
import { createProject, type Project } from '../../core/scene/project';
import {
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Polyline,
  type RasterImage,
  type SceneObject,
  type TextObject,
  type Transform,
  type Vec2,
} from '../../core/scene/scene-object';
import { applyTransform } from '../../core/scene/transform';
import { createPolyline } from '../../core/shapes/create-polyline';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { warpDeformNotice } from './warp-deform-actions';
import { warpDeformRequestForSelection } from './warp-deform-plan';
import type { WarpDeformRequest } from './warp-deform-session';

function closedRect(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
      { x, y },
    ],
  };
}

function art(id: string, polylines: ReadonlyArray<Polyline>, patch: Partial<ImportedSvg> = {}) {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', operationIds: ['cut'], polylines }],
    ...patch,
  };
  return object;
}

function text(id: string): TextObject {
  return {
    kind: 'text',
    id,
    fontKey: 'roboto-regular',
    content: 'L',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    operationIds: ['cut'],
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    paths: [{ color: '#000000', polylines: [closedRect(0, 0, 40, 40)] }],
  };
}

function image(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
  };
}

function layer(id: string): Layer {
  return createLayer({ id, name: id, color: '#000000' });
}

function load(objects: ReadonlyArray<SceneObject>, selected: ReadonlyArray<string>): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: { objects, layers: [layer('cut')], groups: [] },
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

function pointsOf(id: string): ReadonlyArray<Vec2> {
  const object = objectById(id);
  return 'paths' in object ? (object.paths[0]?.polylines[0]?.points ?? []) : [];
}

function lastToast(): string | undefined {
  return useToastStore.getState().toasts.at(-1)?.message;
}

// A session on the current selection with `move` applied to its start handles.
function request(
  grid: 'warp' | 'deform',
  move: (handles: ReadonlyArray<Vec2>) => ReadonlyArray<Vec2>,
): WarpDeformRequest {
  const state = useStore.getState();
  const ids = [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
  const start = warpDeformRequestForSelection(project().scene, ids, grid);
  if (start === null) throw new Error('nothing to warp');
  return { ...start, handles: move(start.handles) };
}

// Pull the second Deform row's inner handles 20 mm down: a smooth bend.
function bendDown(handles: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  return handles.map((handle, index) =>
    index === 5 || index === 6 ? { x: handle.x, y: handle.y + 20 } : handle,
  );
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('applyWarpDeform', () => {
  it('warps a rectangle onto the handles as one undo step, keeping id, bindings and selection', () => {
    load([art('a', [closedRect(0, 0, 100, 50)])], ['a']);
    const before = project();
    const handles = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 120, y: 70 },
      { x: -10, y: 50 },
    ];

    useStore.getState().applyWarpDeform(request('warp', () => handles));

    // A projective warp keeps straight sides straight: no points are added.
    expect(pointsOf('a')).toEqual([...handles, handles[0]]);
    expect(objectById('a')).toMatchObject({
      kind: 'imported-svg',
      operationIds: ['cut'],
      paths: [{ operationIds: ['cut'] }],
    });
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().selectedObjectId).toBe('a');
    expect(useStore.getState().dirty).toBe(true);
    expect(lastToast()).toBe('Warped 1 object.');
  });

  it('deforms a curve into fine lines, keeps it closed and says so', () => {
    const k = 0.5522847498 * 25;
    const circle: CurveSubpath = {
      start: { x: 75, y: 50 },
      closed: true,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 75, y: 50 + k },
          control2: { x: 50 + k, y: 75 },
          to: { x: 50, y: 75 },
        },
        {
          kind: 'cubic',
          control1: { x: 50 - k, y: 75 },
          control2: { x: 25, y: 50 + k },
          to: { x: 25, y: 50 },
        },
        {
          kind: 'cubic',
          control1: { x: 25, y: 50 - k },
          control2: { x: 50 - k, y: 25 },
          to: { x: 50, y: 25 },
        },
        {
          kind: 'cubic',
          control1: { x: 50 + k, y: 25 },
          control2: { x: 75, y: 50 - k },
          to: { x: 75, y: 50 },
        },
      ],
    };
    const compat = closedRect(25, 25, 50, 50);
    load(
      [
        art('c', [compat], {
          paths: [{ color: '#000000', polylines: [compat], curves: [circle] }],
        }),
      ],
      ['c'],
    );

    useStore.getState().applyWarpDeform(request('deform', bendDown));

    const object = objectById('c');
    if (object.kind !== 'imported-svg') throw new Error('kind changed');
    const polyline = object.paths[0]?.polylines[0];
    expect(object.paths[0]?.curves).toBeUndefined();
    expect(polyline?.closed).toBe(true);
    expect(polyline?.points.at(-1)).toEqual(polyline?.points[0]);
    expect(polyline?.points.length).toBeGreaterThan(40);
    expect(lastToast()).toBe('Deformed 1 object. Curves became fine lines within 0.05 mm.');
  });

  it('converts text and drawn shapes to paths in the same step and leaves images alone', () => {
    const rect = {
      ...createRectangle({
        id: 'r',
        color: '#000000',
        spec: { widthMm: 30, heightMm: 20, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 50, y: 0 },
      }),
      operationIds: ['cut'],
    };
    const photo = image('i');
    load([text('t'), rect, photo], ['t', 'r', 'i']);

    useStore.getState().applyWarpDeform(request('deform', bendDown));

    expect(objectById('t')).toMatchObject({ kind: 'imported-svg', id: 't', operationIds: ['cut'] });
    expect(objectById('r')).toMatchObject({ kind: 'imported-svg', id: 'r', operationIds: ['cut'] });
    expect(objectById('r').transform).toEqual(IDENTITY_TRANSFORM);
    expect(objectById('i')).toBe(photo);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(lastToast()).toBe(
      'Deformed 2 objects. 1 text object and 1 drawn shape were converted to paths first. Images and reliefs cannot bend, so 1 was left as it is.',
    );
  });

  it('keeps a drawn line a drawn line, with its points following the bend', () => {
    const line = createPolyline({
      id: 'p',
      color: '#000000',
      spec: {
        points: [
          { x: 0, y: 30 },
          { x: 100, y: 30 },
        ],
        closed: false,
      },
    });
    load([line, art('frame', [closedRect(0, 0, 100, 60)])], ['p', 'frame']);

    useStore.getState().applyWarpDeform(request('deform', bendDown));

    const object = objectById('p');
    if (object.kind !== 'shape' || object.spec.kind !== 'polyline') throw new Error('not a line');
    expect(object.spec.points.length).toBeGreaterThan(2);
    expect(object.paths[0]?.polylines[0]?.points).toEqual(object.spec.points);
    expect(object.paths[0]?.curves).toBeUndefined();
  });

  it('keeps the object transform and bends its world outline', () => {
    const transform: Transform = { ...IDENTITY_TRANSFORM, x: 200, y: 100, rotationDeg: 90 };
    const local = closedRect(0, 0, 40, 20);
    load([art('rot', [local], { transform })], ['rot']);
    const warp = request('warp', (handles) =>
      handles.map((handle, index) =>
        index === 2 ? { x: handle.x + 15, y: handle.y + 5 } : handle,
      ),
    );

    useStore.getState().applyWarpDeform(warp);

    expect(objectById('rot').transform).toBe(transform);
    const world = pointsOf('rot').map((point) => applyTransform(point, transform));
    expect(world[0]?.x).toBeCloseTo(warp.handles[1]?.x ?? Number.NaN, 9);
    expect(world[0]?.y).toBeCloseTo(warp.handles[1]?.y ?? Number.NaN, 9);
  });

  it('applies a fold-over when the handles cross', () => {
    load([art('a', [closedRect(0, 0, 100, 50)])], ['a']);
    const crossed = request('warp', (handles) => [
      handles[0] as Vec2,
      handles[2] as Vec2,
      handles[1] as Vec2,
      handles[3] as Vec2,
    ]);

    useStore.getState().applyWarpDeform(crossed);

    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(pointsOf('a')).toEqual([...crossed.handles, crossed.handles[0]]);
    expect(lastToast()).toBe('Warped 1 object.');
  });

  it('changes nothing and says so when the handles have not moved', () => {
    load([art('a', [closedRect(0, 0, 100, 50)])], ['a']);
    const before = project();

    useStore.getState().applyWarpDeform(request('deform', (handles) => handles));

    expect(project()).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(lastToast()).toBe('The handles have not moved, so nothing changed.');
  });

  it('leaves locked artwork alone and says so', () => {
    const locked = art('locked', [closedRect(0, 0, 10, 10)], { locked: true });
    load([art('a', [closedRect(0, 0, 100, 50)]), locked], ['a', 'locked']);

    useStore.getState().applyWarpDeform(request('deform', bendDown));

    expect(objectById('locked')).toBe(locked);
    expect(lastToast()).toBe('Deformed 1 object. 1 locked object was left as it is.');
  });

  it('starts its handles on the box round the unlocked vector artwork only', () => {
    load([art('a', [closedRect(10, 20, 30, 40)]), image('i')], ['a', 'i']);
    const start = warpDeformRequestForSelection(project().scene, ['a', 'i'], 'warp');
    if (start === null) throw new Error('no session');
    expect(start.objectIds).toEqual(['a']);
    expect(start.box).toEqual({ minX: 10, minY: 20, maxX: 40, maxY: 60 });
    expect(start.handles).toEqual(initialWarpDeformHandles('warp', start.box));
    expect(warpDeformRequestForSelection(project().scene, ['i'], 'warp')).toBeNull();
  });
});

describe('warpDeformNotice', () => {
  const plan = { warped: 3, convertedText: 2, convertedShapes: 0, curvesFlattened: true };

  it('counts in plurals and names everything left alone', () => {
    expect(warpDeformNotice('warp', plan, { imagesAndReliefs: 2, locked: 2 })).toBe(
      'Warped 3 objects. 2 text objects were converted to paths first. Curves became fine lines within 0.05 mm. Images and reliefs cannot bend, so 2 were left as they are. 2 locked objects were left as they are.',
    );
  });

  it('explains when nothing could bend', () => {
    expect(
      warpDeformNotice('deform', { ...plan, warped: 0 }, { imagesAndReliefs: 0, locked: 0 }),
    ).toBe('Nothing to deform: the artwork is no longer there or is locked.');
  });
});
