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

describe('fill selection action', () => {
  beforeEach(() => {
    resetStore();
  });

  it('isolates selected artwork from unselected same-color artwork before making it fill', () => {
    loadScene({
      objects: [shapeObj('outer', '#000000'), shapeObj('inner', '#000000')],
      colors: ['#000000'],
      selectedObjectId: 'inner',
    });
    useStore.setState({ dirty: false, undoStack: [] });

    useStore.getState().fillSelectionSeparately();

    const state = useStore.getState();
    const outer = shapeById('outer');
    const inner = shapeById('inner');
    expect(outer.color).toBe('#000000');
    expect(inner.color).not.toBe('#000000');
    expect(layerByColor('#000000').mode).toBe('line');
    expect(layerByColor(inner.color).mode).toBe('fill');
    expect(state.selectedObjectId).toBe('inner');
    expect(state.additionalSelectedIds.size).toBe(0);
    expect(state.dirty).toBe(true);
    expect(state.undoStack).toHaveLength(1);
  });

  it('reuses an unshared selected layer by switching it to fill mode', () => {
    loadScene({
      objects: [shapeObj('outer', '#000000'), shapeObj('inner', '#0000ff')],
      colors: ['#000000', '#0000ff'],
      selectedObjectId: 'inner',
    });

    useStore.getState().fillSelectionSeparately();

    expect(shapeById('inner').color).toBe('#0000ff');
    expect(useStore.getState().project.scene.layers).toHaveLength(2);
    expect(layerByColor('#0000ff').mode).toBe('fill');
    expect(layerByColor('#000000').mode).toBe('line');
  });

  it('moves a multi-selection that shares color with unselected artwork onto one fill layer', () => {
    loadScene({
      objects: [
        shapeObj('outer', '#000000'),
        shapeObj('inner-a', '#000000'),
        shapeObj('inner-b', '#000000'),
      ],
      colors: ['#000000'],
      selectedObjectId: 'inner-a',
      additionalSelectedIds: new Set(['inner-b']),
    });

    useStore.getState().fillSelectionSeparately();

    const fillColor = shapeById('inner-a').color;
    expect(fillColor).not.toBe('#000000');
    expect(shapeById('inner-b').color).toBe(fillColor);
    expect(shapeById('outer').color).toBe('#000000');
    expect(layerByColor(fillColor).mode).toBe('fill');
    expect(layerByColor('#000000').mode).toBe('line');
  });

  it('does nothing when the selection has no vector artwork', () => {
    loadScene({
      objects: [rasterObj('image')],
      colors: ['#808080'],
      selectedObjectId: 'image',
    });
    const before = useStore.getState().project;

    useStore.getState().fillSelectionSeparately();

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

function loadScene(args: {
  readonly objects: ReadonlyArray<ShapeObject | RasterImage>;
  readonly colors: ReadonlyArray<string>;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds?: ReadonlySet<string>;
}): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: args.objects,
        layers: args.colors.map((color) => createLayer({ id: color, color })),
        groups: [],
      },
    },
    selectedObjectId: args.selectedObjectId,
    additionalSelectedIds: args.additionalSelectedIds ?? new Set(),
  });
}

function shapeObj(id: string, color: string): ShapeObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    color,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ],
  };
}

function rasterObj(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 10,
    lumaBase64: 'gA==',
  };
}

function shapeById(id: string): ShapeObject {
  const object = useStore.getState().project.scene.objects.find((item) => item.id === id);
  if (object?.kind !== 'shape') throw new Error(`missing shape ${id}`);
  return object;
}

function layerByColor(color: string) {
  const layer = useStore.getState().project.scene.layers.find((item) => item.color === color);
  if (layer === undefined) throw new Error(`missing layer ${color}`);
  return layer;
}
