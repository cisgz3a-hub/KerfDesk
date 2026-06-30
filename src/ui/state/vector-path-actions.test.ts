import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ShapeObject,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

describe('vector path actions', () => {
  beforeEach(() => {
    resetStore();
  });

  it('converts selected editable vector objects into baked path objects', () => {
    loadObjects([
      shapeObject('shape-a', '#111111', squarePath('#111111', 0, 0, 2), {
        ...IDENTITY_TRANSFORM,
        x: 5,
        y: 7,
        scaleX: 2,
        scaleY: 3,
      }),
    ]);
    useStore.setState({ selectedObjectId: 'shape-a', dirty: false });

    useStore.getState().convertSelectionToPath();

    const state = useStore.getState();
    const object = state.project.scene.objects[0];
    expect(object).toMatchObject({
      kind: 'imported-svg',
      id: 'shape-a',
      source: 'Shape: rect (paths)',
      transform: IDENTITY_TRANSFORM,
      bounds: { minX: 5, minY: 7, maxX: 9, maxY: 13 },
    });
    expect(object?.kind === 'imported-svg' ? object.paths[0]?.polylines[0]?.points : []).toEqual([
      { x: 5, y: 7 },
      { x: 9, y: 7 },
      { x: 9, y: 13 },
      { x: 5, y: 13 },
      { x: 5, y: 7 },
    ]);
    expect(state.selectedObjectId).toBe('shape-a');
    expect(state.additionalSelectedIds.size).toBe(0);
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);
  });

  it('welds selected closed vector objects into one selected path object', () => {
    loadObjects([
      shapeObject('left', '#222222', squarePath('#222222', 0, 0, 10), IDENTITY_TRANSFORM),
      shapeObject('right', '#222222', squarePath('#222222', 5, 0, 10), IDENTITY_TRANSFORM),
    ]);
    useStore.setState({
      selectedObjectId: 'left',
      additionalSelectedIds: new Set(['right']),
      dirty: false,
    });

    useStore.getState().weldSelection();

    const state = useStore.getState();
    const object = state.project.scene.objects[0];
    expect(state.project.scene.objects).toHaveLength(1);
    expect(object).toMatchObject({
      kind: 'imported-svg',
      source: 'Welded paths',
      bounds: { minX: 0, minY: 0, maxX: 15, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
    });
    expect(object?.kind === 'imported-svg' ? object.paths[0]?.polylines : []).toHaveLength(1);
    expect(state.selectedObjectId).toBe(object?.id);
    expect(state.additionalSelectedIds.size).toBe(0);
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);
  });

  it('does not weld when the selection contains open contours', () => {
    loadObjects([
      shapeObject('open', '#333333', {
        color: '#333333',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
          },
        ],
      }),
    ]);
    useStore.setState({ selectedObjectId: 'open', dirty: false });
    const before = useStore.getState().project;

    useStore.getState().weldSelection();

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

function loadObjects(objects: ReadonlyArray<ShapeObject>): void {
  const colors = [...new Set(objects.map((object) => object.color))];
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects,
        layers: colors.map((color) => createLayer({ id: color, color })),
        groups: [],
      },
    },
  });
}

function shapeObject(
  id: string,
  color: string,
  path: ColoredPath,
  transform = IDENTITY_TRANSFORM,
): ShapeObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    color,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform,
    paths: [path],
  };
}

function squarePath(color: string, x: number, y: number, size: number): ColoredPath {
  return {
    color,
    polylines: [
      {
        closed: true,
        points: [
          { x, y },
          { x: x + size, y },
          { x: x + size, y: y + size },
          { x, y: y + size },
          { x, y },
        ],
      },
    ],
  };
}
