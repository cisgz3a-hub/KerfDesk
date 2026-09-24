import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type RasterImage,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

describe('Delete Duplicates (ADR-377)', () => {
  beforeEach(() => {
    resetStore();
    useToastStore.setState({ toasts: [] });
  });

  it('cleans the whole design in one undo step when nothing is selected', () => {
    load([
      svg('first', [square(0, 0)]),
      svg('copy', [reversed(square(0, 0))]),
      svg('doubled', [square(30, 0), square(30, 0)]),
    ]);

    useStore.getState().deleteDuplicates();

    expect(ids()).toEqual(['first', 'doubled']);
    expect(polylines('doubled')).toHaveLength(1);
    expect(lastToast()).toEqual({ message: 'Deleted 2 duplicate paths.', variant: 'success' });
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();
    expect(ids()).toEqual(['first', 'copy', 'doubled']);
    expect(polylines('doubled')).toHaveLength(2);
  });

  it('only looks inside the selection when something is selected', () => {
    load([svg('a', [square(0, 0)]), svg('b', [square(0, 0)]), svg('c', [square(0, 0)])]);
    useStore.getState().selectObject('b');
    useStore.getState().toggleSelectObject('c');

    useStore.getState().deleteDuplicates();

    expect(ids()).toEqual(['a', 'b']);
    expect(useStore.getState().selectedObjectId).toBe('b');
    expect([...useStore.getState().additionalSelectedIds]).toEqual([]);
  });

  it('leaves locked, hidden and image objects alone', () => {
    const hidden = createLayer({ id: 'hidden', color: '#ff0000' });
    load(
      [
        svg('first', [square(0, 0)]),
        { ...svg('locked', [square(0, 0)]), locked: true },
        { ...svg('on-hidden', [square(0, 0)]), operationIds: ['hidden'], paths: [hiddenPath()] },
        image('photo'),
        image('photo-copy'),
      ],
      [],
      [{ ...hidden, visible: false }],
    );

    useStore.getState().deleteDuplicates();

    expect(ids()).toEqual(['first', 'locked', 'on-hidden', 'photo', 'photo-copy']);
    expect(lastToast()).toEqual({ message: 'No duplicates found.', variant: 'info' });
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('drops a removed copy from its group', () => {
    load(
      [svg('first', [square(0, 0)]), svg('copy', [square(0, 0)]), svg('other', [square(40, 0)])],
      [{ id: 'g', name: 'Group 1', objectIds: ['copy', 'other', 'first'] }],
    );

    useStore.getState().deleteDuplicates();

    expect(useStore.getState().project.scene.groups).toEqual([
      { id: 'g', name: 'Group 1', objectIds: ['other', 'first'] },
    ]);
  });

  it('keeps the copy an image uses as its mask and removes the other', () => {
    load([svg('plain', [square(0, 0)]), svg('mask', [square(0, 0)]), image('photo', 'mask')]);

    useStore.getState().deleteDuplicates();

    expect(ids()).toEqual(['mask', 'photo']);
    const photo = useStore.getState().project.scene.objects.find((object) => object.id === 'photo');
    expect(photo?.kind === 'raster-image' ? photo.imageMaskId : undefined).toBe('mask');
  });

  it('keeps copies that are each the mask of a different image', () => {
    load([
      svg('mask-a', [square(0, 0)]),
      svg('mask-b', [square(0, 0)]),
      image('photo-a', 'mask-a'),
      image('photo-b', 'mask-b'),
    ]);

    useStore.getState().deleteDuplicates();

    expect(ids()).toEqual(['mask-a', 'mask-b', 'photo-a', 'photo-b']);
    expect(lastToast()).toEqual({ message: 'No duplicates found.', variant: 'info' });
  });
});

describe('Rubber-band outline (ADR-377)', () => {
  beforeEach(() => {
    resetStore();
    useToastStore.setState({ toasts: [] });
  });

  it('adds a selected convex outline on a new Line operation in one undo step', () => {
    load([svg('left', [square(0, 0)]), svg('right', [square(40, 20)])]);
    useStore.getState().selectObject('left');
    useStore.getState().toggleSelectObject('right');

    useStore.getState().createRubberBandOutline();

    const state = useStore.getState();
    const outline = state.project.scene.objects.at(-1);
    expect(outline?.kind).toBe('imported-svg');
    if (outline?.kind !== 'imported-svg') return;
    expect(outline.source).toBe('Rubber-band outline');
    expect(outline.paths[0]?.polylines[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 50, y: 20 },
      { x: 50, y: 30 },
      { x: 40, y: 30 },
      { x: 0, y: 10 },
    ]);
    const operation = state.project.scene.layers.find((layer) =>
      outline.operationIds?.includes(layer.id),
    );
    expect(operation).toMatchObject({ mode: 'line', name: 'Rubber-band outline' });
    expect(outline.paths[0]?.color).toBe(operation?.color);
    expect(state.selectedObjectId).toBe(outline.id);
    expect(state.additionalSelectedIds.size).toBe(0);
    expect(state.undoStack).toHaveLength(1);

    useStore.getState().undo();
    expect(ids()).toEqual(['left', 'right']);
  });

  it('warns and changes nothing when the selection is a single line', () => {
    load([
      svg('line', [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
        },
      ]),
    ]);
    useStore.getState().selectObject('line');
    const before = useStore.getState().project;

    useStore.getState().createRubberBandOutline();

    expect(useStore.getState().project).toBe(before);
    expect(lastToast()?.variant).toBe('warning');
  });
});

function load(
  objects: ReadonlyArray<SceneObject>,
  groups: ReadonlyArray<SceneGroup> = [],
  extraLayers: ReadonlyArray<Layer> = [],
): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [...objects],
        layers: [
          createLayer({ id: 'cut', color: '#000000' }),
          createLayer({ id: 'image', color: '#333333', mode: 'image' }),
          ...extraLayers,
        ],
        groups,
      },
    },
    undoStack: [],
    dirty: false,
  });
}

function svg(id: string, polylines: ReadonlyArray<Polyline>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines }],
  };
}

function hiddenPath(): ImportedSvg['paths'][number] {
  return { color: '#ff0000', polylines: [square(0, 0)] };
}

function image(id: string, imageMaskId?: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    pixelWidth: 10,
    pixelHeight: 10,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['image'],
    color: '#333333',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    ...(imageMaskId === undefined ? {} : { imageMaskId }),
  } as unknown as RasterImage;
}

function square(x: number, y: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + 10, y },
      { x: x + 10, y: y + 10 },
      { x, y: y + 10 },
    ],
  };
}

function reversed(polyline: Polyline): Polyline {
  return { ...polyline, points: [...polyline.points].reverse() };
}

function ids(): ReadonlyArray<string> {
  return useStore.getState().project.scene.objects.map((object) => object.id);
}

function polylines(id: string): ReadonlyArray<Polyline> {
  const object = useStore.getState().project.scene.objects.find((item) => item.id === id);
  return object?.kind === 'imported-svg' ? object.paths.flatMap((path) => path.polylines) : [];
}

function lastToast(): { readonly message: string; readonly variant: string } | undefined {
  const toast = useToastStore.getState().toasts.at(-1);
  return toast === undefined ? undefined : { message: toast.message, variant: toast.variant };
}
