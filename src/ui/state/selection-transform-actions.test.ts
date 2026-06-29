import { beforeEach, describe, expect, it } from 'vitest';
import { applyTransform, IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import { resetStore, svgObj } from './test-helpers';
import { useStore } from './store';

describe('selection transform actions', () => {
  beforeEach(() => resetStore());

  it('applies multiple object transforms as one undoable edit', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('B', ['#00ff00']));
    const beforeA = useStore.getState().project.scene.objects.find((object) => object.id === 'A');
    const beforeB = useStore.getState().project.scene.objects.find((object) => object.id === 'B');
    useStore.setState({ undoStack: [], dirty: false });

    useStore.getState().applySelectionTransforms([
      { id: 'A', transform: { ...IDENTITY_TRANSFORM, x: 10, y: 20 } },
      { id: 'B', transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40 } },
    ]);

    const after = useStore.getState();
    expect(
      after.project.scene.objects.find((object) => object.id === 'A')?.transform,
    ).toMatchObject({ x: 10, y: 20 });
    expect(
      after.project.scene.objects.find((object) => object.id === 'B')?.transform,
    ).toMatchObject({ x: 30, y: 40 });
    expect(after.undoStack).toHaveLength(1);
    expect(after.dirty).toBe(true);

    useStore.getState().undo();

    const restored = useStore.getState();
    expect(
      restored.project.scene.objects.find((object) => object.id === 'A')?.transform,
    ).toMatchObject({ x: beforeA?.transform.x, y: beforeA?.transform.y });
    expect(
      restored.project.scene.objects.find((object) => object.id === 'B')?.transform,
    ).toMatchObject({ x: beforeB?.transform.x, y: beforeB?.transform.y });
  });

  it('does not apply stale selection transform edits to locked objects', () => {
    useStore.getState().importSvgObject({ ...svgObj('A', ['#ff0000']), locked: true });
    const before = useStore.getState().project.scene.objects[0]?.transform;
    useStore.setState({ undoStack: [], dirty: false });

    useStore
      .getState()
      .applySelectionTransforms([{ id: 'A', transform: { ...IDENTITY_TRANSFORM, x: 10, y: 20 } }]);

    const state = useStore.getState();
    expect(state.project.scene.objects[0]?.transform).toEqual(before);
    expect(state.undoStack).toHaveLength(0);
    expect(state.dirty).toBe(false);
  });

  it('does not apply stale selection transform edits to hidden-layer objects', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().setLayerParam('#ff0000', { visible: false });
    const before = useStore.getState().project.scene.objects[0]?.transform;
    useStore.setState({ undoStack: [], dirty: false });

    useStore
      .getState()
      .applySelectionTransforms([{ id: 'A', transform: { ...IDENTITY_TRANSFORM, x: 10, y: 20 } }]);

    const state = useStore.getState();
    expect(state.project.scene.objects[0]?.transform).toEqual(before);
    expect(state.undoStack).toHaveLength(0);
    expect(state.dirty).toBe(false);
  });

  it('aligns a multi-selection to the last selected reference as one undoable edit', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('B', ['#00ff00']));
    useStore.getState().applySelectionTransforms([
      { id: 'A', transform: { ...IDENTITY_TRANSFORM, x: 10, y: 0 } },
      { id: 'B', transform: { ...IDENTITY_TRANSFORM, x: 40, y: 25 } },
    ]);
    useStore.setState({
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(['B']),
      undoStack: [],
      dirty: false,
    });

    useStore.getState().alignSelection('left');

    const after = useStore.getState();
    expect(
      after.project.scene.objects.find((object) => object.id === 'A')?.transform,
    ).toMatchObject({ x: 40, y: 0 });
    expect(
      after.project.scene.objects.find((object) => object.id === 'B')?.transform,
    ).toMatchObject({ x: 40, y: 25 });
    expect(after.undoStack).toHaveLength(1);
    expect(after.dirty).toBe(true);

    useStore.getState().undo();

    const restored = useStore.getState();
    expect(
      restored.project.scene.objects.find((object) => object.id === 'A')?.transform,
    ).toMatchObject({ x: 10, y: 0 });
    expect(
      restored.project.scene.objects.find((object) => object.id === 'B')?.transform,
    ).toMatchObject({ x: 40, y: 25 });
  });

  it('distributes a multi-selection as one undoable edit', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('B', ['#00ff00']));
    useStore.getState().importSvgObject(svgObj('C', ['#0000ff']));
    useStore.getState().applySelectionTransforms([
      { id: 'A', transform: { ...IDENTITY_TRANSFORM, x: 0, y: 0 } },
      { id: 'B', transform: { ...IDENTITY_TRANSFORM, x: 100, y: 0 } },
      { id: 'C', transform: { ...IDENTITY_TRANSFORM, x: 40, y: 0 } },
    ]);
    useStore.setState({
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(['B', 'C']),
      undoStack: [],
      dirty: false,
    });

    useStore.getState().distributeSelection('horizontal-centers');

    const after = useStore.getState();
    expect(
      after.project.scene.objects.find((object) => object.id === 'A')?.transform,
    ).toMatchObject({ x: 0, y: 0 });
    expect(
      after.project.scene.objects.find((object) => object.id === 'B')?.transform,
    ).toMatchObject({ x: 100, y: 0 });
    expect(
      after.project.scene.objects.find((object) => object.id === 'C')?.transform,
    ).toMatchObject({ x: 50, y: 0 });
    expect(after.undoStack).toHaveLength(1);
    expect(after.dirty).toBe(true);

    useStore.getState().undo();

    const restored = useStore.getState();
    expect(
      restored.project.scene.objects.find((object) => object.id === 'C')?.transform,
    ).toMatchObject({ x: 40, y: 0 });
  });

  it('nudges a multi-selection as one undoable edit', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('B', ['#00ff00']));
    useStore.getState().applySelectionTransforms([
      { id: 'A', transform: { ...IDENTITY_TRANSFORM, x: 10, y: 20 } },
      { id: 'B', transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40 } },
    ]);
    useStore.setState({
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(['B']),
      undoStack: [],
      dirty: false,
    });

    useStore.getState().nudgeSelection(1, -2);

    const after = useStore.getState();
    expect(
      after.project.scene.objects.find((object) => object.id === 'A')?.transform,
    ).toMatchObject({ x: 11, y: 18 });
    expect(
      after.project.scene.objects.find((object) => object.id === 'B')?.transform,
    ).toMatchObject({ x: 31, y: 38 });
    expect(after.undoStack).toHaveLength(1);

    useStore.getState().undo();

    const restored = useStore.getState();
    expect(
      restored.project.scene.objects.find((object) => object.id === 'A')?.transform,
    ).toMatchObject({ x: 10, y: 20 });
    expect(
      restored.project.scene.objects.find((object) => object.id === 'B')?.transform,
    ).toMatchObject({ x: 30, y: 40 });
  });

  it('flips a multi-selection horizontally around the combined selection center', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('B', ['#00ff00']));
    useStore.getState().applySelectionTransforms([
      { id: 'A', transform: { ...IDENTITY_TRANSFORM, x: 0, y: 0 } },
      { id: 'B', transform: { ...IDENTITY_TRANSFORM, x: 30, y: 0 } },
    ]);
    useStore.setState({
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(['B']),
      undoStack: [],
      dirty: false,
    });

    useStore.getState().flipSelection('horizontal');

    const after = useStore.getState();
    const a = after.project.scene.objects.find((object) => object.id === 'A');
    const b = after.project.scene.objects.find((object) => object.id === 'B');
    if (a === undefined || b === undefined) throw new Error('expected both objects');
    expect(a.transform.mirrorX).toBe(true);
    expect(b.transform.mirrorX).toBe(true);
    expect(transformedCenter(a).x).toBeCloseTo(35, 6);
    expect(transformedCenter(b).x).toBeCloseTo(5, 6);
    expect(after.undoStack).toHaveLength(1);

    useStore.getState().undo();

    const restored = useStore.getState();
    expect(
      restored.project.scene.objects.find((object) => object.id === 'A')?.transform.mirrorX,
    ).toBe(false);
    expect(
      restored.project.scene.objects.find((object) => object.id === 'B')?.transform.mirrorX,
    ).toBe(false);
  });
});

function transformedCenter(object: SceneObject): { readonly x: number; readonly y: number } {
  return applyTransform(
    {
      x: (object.bounds.minX + object.bounds.maxX) / 2,
      y: (object.bounds.minY + object.bounds.maxY) / 2,
    },
    object.transform,
  );
}
