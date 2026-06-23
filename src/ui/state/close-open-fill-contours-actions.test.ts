import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type ShapeObject,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

describe('close open fill contours action', () => {
  beforeEach(() => {
    resetStore();
  });

  it('closes selected open fill contours whose endpoints are within the safe tolerance', () => {
    loadScene({
      objects: [shapeObj('near-open-fill', '#000000', nearClosedPolyline(false))],
      layers: [{ color: '#000000', mode: 'fill' }],
      selectedObjectId: 'near-open-fill',
    });
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });

    useStore.getState().closeSelectedOpenFillContours();

    const state = useStore.getState();
    expect(polylineFor('near-open-fill').closed).toBe(true);
    expect(state.dirty).toBe(true);
    expect(state.undoStack).toHaveLength(1);
    expect(state.redoStack).toHaveLength(0);
  });

  it('leaves unsafe, unselected, locked, line-layer, and raster contours unchanged', () => {
    loadScene({
      objects: [
        shapeObj('far-open-fill', '#000000', farOpenPolyline(false)),
        shapeObj('unselected-open-fill', '#000000', nearClosedPolyline(false)),
        shapeObj('locked-open-fill', '#000000', nearClosedPolyline(false), { locked: true }),
        shapeObj('line-open', '#ff0000', nearClosedPolyline(false)),
        rasterObj('raster', '#000000'),
      ],
      layers: [
        { color: '#000000', mode: 'fill' },
        { color: '#ff0000', mode: 'line' },
      ],
      selectedObjectId: 'far-open-fill',
      additionalSelectedIds: new Set(['locked-open-fill', 'line-open', 'raster']),
    });
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });
    const before = useStore.getState().project;

    useStore.getState().closeSelectedOpenFillContours();

    const state = useStore.getState();
    expect(state.project).toBe(before);
    expect(polylineFor('far-open-fill').closed).toBe(false);
    expect(polylineFor('unselected-open-fill').closed).toBe(false);
    expect(polylineFor('locked-open-fill').closed).toBe(false);
    expect(polylineFor('line-open').closed).toBe(false);
    expect(state.dirty).toBe(false);
    expect(state.undoStack).toHaveLength(0);
  });

  it('closes selected open fill contours only after an explicit reviewed tolerance is applied', () => {
    loadScene({
      objects: [
        shapeObj('review-open-fill', '#000000', [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 2, y: 2 },
        ]),
        shapeObj('too-wide-open-fill', '#000000', [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 4, y: 4 },
        ]),
      ],
      layers: [{ color: '#000000', mode: 'fill' }],
      selectedObjectId: 'review-open-fill',
      additionalSelectedIds: new Set(['too-wide-open-fill']),
    });
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });

    useStore.getState().closeSelectedOpenFillContours();

    expect(polylineFor('review-open-fill').closed).toBe(false);
    expect(polylineFor('too-wide-open-fill').closed).toBe(false);

    (
      useStore.getState() as typeof useStore extends { getState: () => infer State }
        ? State & {
            readonly closeSelectedOpenFillContoursWithTolerance: (toleranceMm: number) => void;
          }
        : never
    ).closeSelectedOpenFillContoursWithTolerance(3);

    const state = useStore.getState();
    expect(polylineFor('review-open-fill').closed).toBe(true);
    expect(polylineFor('too-wide-open-fill').closed).toBe(false);
    expect(state.dirty).toBe(true);
    expect(state.undoStack).toHaveLength(1);
    expect(state.redoStack).toHaveLength(0);
  });
});

function loadScene(args: {
  readonly objects: ReadonlyArray<ShapeObject | RasterImage>;
  readonly layers: ReadonlyArray<{ readonly color: string; readonly mode: 'fill' | 'line' }>;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds?: ReadonlySet<string>;
}): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: args.objects,
        layers: args.layers.map((layer) =>
          createLayer({ id: layer.color, color: layer.color, mode: layer.mode }),
        ),
        groups: [],
      },
    },
    selectedObjectId: args.selectedObjectId,
    additionalSelectedIds: args.additionalSelectedIds ?? new Set(),
  });
}

function shapeObj(
  id: string,
  color: string,
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  options: { readonly locked?: boolean } = {},
): ShapeObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'polyline', points, closed: false },
    color,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    ...(options.locked === undefined ? {} : { locked: options.locked }),
    paths: [
      {
        color,
        polylines: [{ points, closed: false }],
      },
    ],
  };
}

function rasterObj(id: string, color: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color,
    dither: 'grayscale',
    linesPerMm: 10,
    lumaBase64: 'gA==',
  };
}

function nearClosedPolyline(
  closed: boolean,
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  return closed
    ? [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 0 },
      ]
    : [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0.25, y: 0.25 },
      ];
}

function farOpenPolyline(
  closed: boolean,
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  return closed
    ? [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 0 },
      ]
    : [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 2, y: 2 },
      ];
}

function polylineFor(id: string) {
  const object = useStore.getState().project.scene.objects.find((item) => item.id === id);
  if (object?.kind !== 'shape') throw new Error(`missing shape ${id}`);
  return object.paths[0]?.polylines[0] ?? fail(`missing polyline ${id}`);
}

function fail(message: string): never {
  throw new Error(message);
}
