// Store behaviour of the LightBurn gap batch 5 design tools (ADR-480):
// Create Rubber-Band Outline, Select Contained, Select Smaller Shapes and
// Flatten Image Mask. Delete Duplicates, Close Path and Reverse Direction are
// covered in path-cleanup-actions.test.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { RUBBER_BAND_OUTLINE_SOURCE } from '../../core/geometry/rubber-band-outline';
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
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

type Point = readonly [number, number];

function poly(points: ReadonlyArray<Point>, closed: boolean): Polyline {
  return { closed, points: points.map(([x, y]) => ({ x, y })) };
}

function rect(width: number, height: number): Polyline {
  return poly(
    [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
    true,
  );
}

// Open, three points, ends 10 mm apart.
const OPEN_TRIANGLE = poly(
  [
    [0, 0],
    [10, 0],
    [6, 8],
  ],
  false,
);

function art(
  id: string,
  polylines: ReadonlyArray<Polyline>,
  patch: Partial<ImportedSvg> = {},
): ImportedSvg {
  const xs = polylines.flatMap((polyline) => polyline.points.map((point) => point.x));
  const ys = polylines.flatMap((polyline) => polyline.points.map((point) => point.y));
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
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines }],
    ...patch,
  };
}

function box(
  id: string,
  x: number,
  y: number,
  width: number,
  height = width,
  patch: Partial<ImportedSvg> = {},
): ImportedSvg {
  return art(id, [rect(width, height)], { transform: { ...IDENTITY_TRANSFORM, x, y }, ...patch });
}

function layer(id: string, patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id, name: id, color: '#000000' }), ...patch };
}

function load(
  objects: ReadonlyArray<SceneObject>,
  selected: ReadonlyArray<string> = [],
  layers: ReadonlyArray<Layer> = [layer('cut')],
  scene: Partial<Scene> = {},
): void {
  useStore.setState({
    project: { ...createProject(), scene: { objects, layers, groups: [], ...scene } },
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    dirty: false,
  });
}

function project(): Project {
  return useStore.getState().project;
}

function objectIds(): ReadonlyArray<string> {
  return project().scene.objects.map((object) => object.id);
}

function objectById(id: string): SceneObject {
  const object = project().scene.objects.find((entry) => entry.id === id);
  if (object === undefined) throw new Error(`object ${id} missing`);
  return object;
}

function polylinesOf(id: string): ReadonlyArray<Polyline> {
  const object = objectById(id);
  return 'paths' in object ? object.paths.flatMap((path) => path.polylines) : [];
}

function selection(): ReadonlyArray<string> {
  const state = useStore.getState();
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ].sort();
}

function select(...ids: ReadonlyArray<string>): void {
  useStore.setState({
    selectedObjectId: ids[0] ?? null,
    additionalSelectedIds: new Set(ids.slice(1)),
  });
}

function undoCount(): number {
  return useStore.getState().undoStack.length;
}

function lastToast(): { readonly message: string; readonly variant: string } | undefined {
  const toast = useToastStore.getState().toasts.at(-1);
  return toast === undefined ? undefined : { message: toast.message, variant: toast.variant };
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Create Rubber-Band Outline', () => {
  it('adds one closed outline around the selection, selected alone, in one undo step', () => {
    load([box('a', 0, 0, 10), box('b', 30, 20, 10)], ['a', 'b']);
    const before = project();

    expect(useStore.getState().addRubberBandOutline()).toBe(true);

    const objects = project().scene.objects;
    const outline = objects.at(-1)!;
    expect(objects).toHaveLength(3);
    expect(outline).toMatchObject({
      kind: 'imported-svg',
      source: RUBBER_BAND_OUTLINE_SOURCE,
      bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
    });
    const polylines = polylinesOf(outline.id);
    expect(polylines).toHaveLength(1);
    expect(polylines[0]?.closed).toBe(true);
    expect(new Set(polylines[0]?.points.map((point) => `${point.x},${point.y}`)).size).toBe(6);
    expect(polylines[0]?.points).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 40, y: 20 },
        { x: 40, y: 30 },
        { x: 30, y: 30 },
        { x: 0, y: 10 },
      ]),
    );
    expect(selection()).toEqual([outline.id]);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(lastToast()).toEqual({
      message: 'Added a rubber-band outline around 2 objects (40 × 30 mm).',
      variant: 'success',
    });

    useStore.getState().undo();
    expect(project()).toBe(before);
  });

  it('cuts the outline with a copy of the first selected Line operation', () => {
    load(
      [box('engraving', 0, 0, 10, 10, { operationIds: ['fill'] }), box('part', 30, 0, 10)],
      ['engraving', 'part'],
      [layer('fill', { mode: 'fill', color: '#ff0000' }), layer('cut', { power: 42, speed: 900 })],
    );

    useStore.getState().addRubberBandOutline();

    const scene = project().scene;
    const outline = scene.objects.at(-1)!;
    const operation = scene.layers.find((entry) => outline.operationIds?.includes(entry.id));
    expect(scene.layers).toHaveLength(3);
    expect(operation?.id).not.toBe('cut');
    expect(operation).toMatchObject({ mode: 'line', power: 42, speed: 900 });
    expect(scene.layers.find((entry) => entry.id === 'cut')?.power).toBe(42);
  });

  it('gives the outline a new Line operation when nothing selected is cut as a line', () => {
    load(
      [box('a', 0, 0, 10, 10, { operationIds: ['fill'] })],
      ['a'],
      [layer('fill', { mode: 'fill', power: 70 })],
    );

    useStore.getState().addRubberBandOutline();

    const scene = project().scene;
    const outline = scene.objects.at(-1)!;
    const operation = scene.layers.find((entry) => outline.operationIds?.includes(entry.id));
    expect(operation).toMatchObject({ mode: 'line', name: 'Outline' });
    expect(operation?.power).not.toBe(70);
  });

  it('refuses a selection that lies on one straight line', () => {
    const line = poly(
      [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      false,
    );
    load([art('line', [line])], ['line']);
    const before = project();

    expect(useStore.getState().addRubberBandOutline()).toBe(false);

    expect(project()).toBe(before);
    expect(undoCount()).toBe(0);
    expect(lastToast()).toEqual({
      message: 'The selection has no area to outline: it lies on one straight line.',
      variant: 'warning',
    });
  });

  it('does nothing without a selection', () => {
    load([box('a', 0, 0, 10)]);

    expect(useStore.getState().addRubberBandOutline()).toBe(false);
    expect(objectIds()).toEqual(['a']);
    expect(lastToast()).toBeUndefined();
  });
});

describe('Select Contained', () => {
  it('adds only the artwork lying fully inside the selected closed shape', () => {
    load(
      [
        box('big', 0, 0, 100),
        box('inside', 10, 10, 10),
        box('straddling', 95, 10, 10),
        box('outside', 200, 0, 10),
      ],
      ['big'],
    );

    useStore.getState().selectContainedShapes();

    expect(selection()).toEqual(['big', 'inside']);
    expect(lastToast()).toEqual({
      message: 'Added 1 object lying inside the selected shape.',
      variant: 'info',
    });
  });

  it('never picks locked artwork or artwork on a hidden operation', () => {
    load(
      [
        box('big', 0, 0, 100),
        box('inside', 10, 10, 10),
        box('held', 30, 30, 10, 10, { locked: true }),
        box('hidden', 50, 50, 10, 10, { operationIds: ['off'] }),
      ],
      ['big'],
      [layer('cut'), layer('off', { visible: false, color: '#00ff00' })],
    );

    useStore.getState().selectContainedShapes();

    expect(selection()).toEqual(['big', 'inside']);
  });

  it('explains when no closed shape is selected or nothing lies inside', () => {
    load(
      [
        art('open', [OPEN_TRIANGLE], { transform: { ...IDENTITY_TRANSFORM, x: 300 } }),
        box('big', 0, 0, 100),
      ],
      ['open'],
    );

    useStore.getState().selectContainedShapes();
    expect(lastToast()?.message).toBe(
      'Select a closed shape first. Select Contained adds the artwork inside it.',
    );
    expect(selection()).toEqual(['open']);

    select('big');
    useStore.getState().selectContainedShapes();
    expect(lastToast()?.message).toBe('Nothing lies fully inside the selected shape.');
    expect(selection()).toEqual(['big']);
    expect(undoCount()).toBe(0);
  });
});

describe('Select Smaller Shapes', () => {
  it('adds artwork no wider and no taller than the selection and keeps the selection', () => {
    load(
      [
        box('ref', 0, 0, 20),
        box('small', 30, 0, 10),
        box('same', 60, 0, 20),
        box('wide', 0, 40, 30, 5),
        box('tall', 40, 40, 5, 30),
      ],
      ['ref'],
    );

    useStore.getState().selectSmallerShapes();

    expect(selection()).toEqual(['ref', 'same', 'small']);
    expect(lastToast()?.message).toBe('Added 2 objects no wider and no taller than the selection.');
  });

  it('says when nothing is selected or nothing is as small', () => {
    load([box('ref', 0, 0, 5), box('big', 10, 0, 20)]);

    useStore.getState().selectSmallerShapes();
    expect(lastToast()?.message).toBe(
      'Select a shape first. Select Smaller Shapes adds artwork no bigger than it.',
    );

    select('ref');
    useStore.getState().selectSmallerShapes();
    expect(lastToast()?.message).toBe('No other artwork is as small as the selection.');
    expect(selection()).toEqual(['ref']);
  });
});

describe('Flatten Image Mask', () => {
  function raster(id: string, patch: Partial<RasterImage> = {}): RasterImage {
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
      ...patch,
    };
  }

  const FLATTENED = raster('baked', { dataUrl: 'data:image/png;base64,baked', imageMaskId: 'M1' });

  function loadMasked(
    maskPatch: Partial<SceneObject> = {},
    extra: ReadonlyArray<SceneObject> = [],
  ): void {
    const mask = {
      ...createRectangle({
        id: 'M1',
        color: '#000000',
        spec: { widthMm: 2, heightMm: 1, cornerRadiusMm: 0 },
      }),
      ...maskPatch,
    } as SceneObject;
    const objects = [raster('R1', { imageMaskId: 'M1' }), mask, box('other', 10, 10, 5), ...extra];
    load(objects, ['R1'], [layer('image', { mode: 'image', color: '#808080' }), layer('cut')], {
      artworkOrder: objects.map((object) => object.id),
      groups: [{ id: 'g', name: 'Group', objectIds: ['R1', 'M1', 'other'] }],
    });
  }

  it('bakes the mask into the image and deletes the mask shape in one undo step', () => {
    loadMasked();
    const before = project();

    expect(useStore.getState().flattenImageMask('R1', FLATTENED)).toBe('mask-deleted');

    const { imageMaskId: _mask, ...baked } = { ...FLATTENED, id: 'R1' };
    expect(objectById('R1')).toEqual(baked);
    expect(objectById('R1')).not.toHaveProperty('imageMaskId');
    expect(objectIds()).toEqual(['R1', 'other']);
    expect(project().scene.artworkOrder).toEqual(['R1', 'other']);
    expect(project().scene.groups).toEqual([
      { id: 'g', name: 'Group', objectIds: ['R1', 'other'] },
    ]);
    expect(useStore.getState().selectedObjectId).toBe('R1');
    expect(useStore.getState().undoStack).toEqual([before]);

    useStore.getState().undo();
    expect(project()).toBe(before);
  });

  it('keeps a locked mask shape', () => {
    loadMasked({ locked: true });

    expect(useStore.getState().flattenImageMask('R1', FLATTENED)).toBe('mask-kept');

    expect(objectIds()).toEqual(['R1', 'M1', 'other']);
    expect(objectById('R1')).not.toHaveProperty('imageMaskId');
    expect(undoCount()).toBe(1);
  });

  it('keeps a mask shape that another image still uses', () => {
    loadMasked({}, [raster('R2', { imageMaskId: 'M1' })]);

    expect(useStore.getState().flattenImageMask('R1', FLATTENED)).toBe('mask-kept');

    expect(objectIds()).toEqual(['R1', 'M1', 'other', 'R2']);
    expect(objectById('R2')).toHaveProperty('imageMaskId', 'M1');
  });

  it('changes nothing for an image without a mask', () => {
    load(
      [raster('R1'), box('other', 10, 10, 5)],
      ['R1'],
      [layer('image', { mode: 'image', color: '#808080' }), layer('cut')],
    );
    const before = project();

    expect(useStore.getState().flattenImageMask('R1', FLATTENED)).toBe('unchanged');
    expect(useStore.getState().flattenImageMask('missing', FLATTENED)).toBe('unchanged');

    expect(project()).toBe(before);
    expect(undoCount()).toBe(0);
  });
});
