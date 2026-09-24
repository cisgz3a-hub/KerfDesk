import { beforeEach, describe, expect, it } from 'vitest';
import { combinedBBox, IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import { resetStore, svgObj } from './test-helpers';
import { useStore } from './store';

// Every svgObj is a 10 x 10 mm box at its transform origin, so an object's
// transform x/y is also its bounding-box minimum.

describe('arranging a selection that contains a group', () => {
  beforeEach(() => resetStore());

  it('aligns a group as one unit, keeping its members offset from each other', () => {
    seed({ A: [10, 0], B: [30, 20], R: [60, 40] });
    group(['A', 'B']);
    useStore.getState().selectObject('A');
    useStore.getState().toggleSelectObject('R');
    useStore.setState({ undoStack: [], dirty: false });

    useStore.getState().alignSelection('left');

    expect(position('A')).toEqual({ x: 60, y: 0 });
    expect(position('B')).toEqual({ x: 80, y: 20 });
    expect(position('R')).toEqual({ x: 60, y: 40 });
    expect(combinedBBox(objects(['A', 'B']))?.minX).toBe(60);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();

    expect(position('A')).toEqual({ x: 10, y: 0 });
    expect(position('B')).toEqual({ x: 30, y: 20 });
  });

  it('uses the whole group as the reference when its member is the last selected object', () => {
    // R is created first, so selecting R and then the group leaves the group's
    // member B as the last selected object.
    seed({ R: [60, 40], A: [10, 0], B: [30, 20] });
    group(['A', 'B']);
    useStore.getState().selectObject('R');
    useStore.getState().toggleSelectObject('A');
    expect(selectedIds().at(-1)).toBe('B');

    useStore.getState().alignSelection('right');

    // The group spans x 10..40, so R's right edge moves to 40 and the members
    // stay where they are.
    expect(position('R')).toEqual({ x: 30, y: 40 });
    expect(position('A')).toEqual({ x: 10, y: 0 });
    expect(position('B')).toEqual({ x: 30, y: 20 });
  });

  it('distributes a group as one item and moves its members together', () => {
    seed({ L: [0, 0], A: [30, 0], B: [45, 10], R: [100, 0] });
    group(['A', 'B']);
    useStore.getState().selectAllObjects();
    useStore.setState({ undoStack: [] });

    useStore.getState().distributeSelection('horizontal-spacing');

    // Three items of widths 10, 25 and 10 across x 0..110 leave two 32.5 mm
    // gaps, so the group's left edge moves from 30 to 42.5.
    expect(position('A')).toEqual({ x: 42.5, y: 0 });
    expect(position('B')).toEqual({ x: 57.5, y: 10 });
    expect(position('L')).toEqual({ x: 0, y: 0 });
    expect(position('R')).toEqual({ x: 100, y: 0 });
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('leaves a lone group unchanged, because it is one object', () => {
    seed({ A: [10, 0], B: [30, 20], C: [60, 40] });
    group(['A', 'B', 'C']);
    useStore.getState().selectObject('A');
    useStore.setState({ undoStack: [], dirty: false });

    useStore.getState().alignSelection('left');
    useStore.getState().distributeSelection('horizontal-centers');

    expect(position('A')).toEqual({ x: 10, y: 0 });
    expect(position('B')).toEqual({ x: 30, y: 20 });
    expect(position('C')).toEqual({ x: 60, y: 40 });
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
  });
});

function seed(positions: Readonly<Record<string, readonly [number, number]>>): void {
  const entries = Object.entries(positions);
  for (const [id] of entries) useStore.getState().importSvgObject(svgObj(id, ['#ff0000']));
  const placements = entries.map(([id, [x, y]]) => ({
    id,
    transform: { ...IDENTITY_TRANSFORM, x, y },
  }));
  useStore.getState().applySelectionTransforms(placements);
}

function group(ids: ReadonlyArray<string>): void {
  useStore.getState().selectObjects(ids);
  useStore.getState().groupSelection();
}

function selectedIds(): ReadonlyArray<string> {
  const state = useStore.getState();
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
}

function objects(ids: ReadonlyArray<string>): ReadonlyArray<SceneObject> {
  return useStore.getState().project.scene.objects.filter((object) => ids.includes(object.id));
}

function position(id: string): { readonly x: number; readonly y: number } | undefined {
  const transform = objects([id])[0]?.transform;
  return transform === undefined ? undefined : { x: transform.x, y: transform.y };
}
