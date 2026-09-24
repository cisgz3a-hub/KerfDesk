import { beforeEach, describe, expect, it } from 'vitest';
import { inSelectionOrder, orderedSelectionIds } from './selection-order';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

// Objects are imported A, B, C, D, so that is also their stacking order.

describe('selection pick order (ADR-377)', () => {
  beforeEach(() => {
    resetStore();
    for (const id of ['A', 'B', 'C', 'D']) {
      useStore.getState().importSvgObject(svgObj(id, ['#ff0000']));
    }
    useStore.getState().selectObject(null);
  });

  it('records clicks and Shift-clicks in the order they happen', () => {
    useStore.getState().selectObject('C');
    useStore.getState().toggleSelectObject('A');
    useStore.getState().toggleSelectObject('D');

    expect(order()).toEqual(['C', 'A', 'D']);
    // The selection itself stays in stacking order.
    expect(stackingSelection()).toEqual(['A', 'C', 'D']);
  });

  it('drops a Shift-clicked object from the order and appends it when picked again', () => {
    useStore.getState().selectObject('C');
    useStore.getState().toggleSelectObject('A');
    useStore.getState().toggleSelectObject('D');

    useStore.getState().toggleSelectObject('A');
    expect(order()).toEqual(['C', 'D']);

    useStore.getState().toggleSelectObject('A');
    expect(order()).toEqual(['C', 'D', 'A']);
  });

  it('starts a new order on a plain click and clears it on deselect', () => {
    useStore.getState().selectObject('C');
    useStore.getState().toggleSelectObject('A');

    useStore.getState().selectObject('B');
    expect(order()).toEqual(['B']);

    useStore.getState().selectObject(null);
    expect(order()).toEqual([]);
    expect(useStore.getState().selectionOrder).toEqual([]);
  });

  it('adds a marquee batch in stacking order after the earlier picks', () => {
    useStore.getState().selectObject('C');

    useStore.getState().selectObjects(['D', 'A'], { additive: true });
    expect(order()).toEqual(['C', 'A', 'D']);

    useStore.getState().selectObjects(['D', 'B']);
    expect(order()).toEqual(['B', 'D']);
  });

  it('keeps a group together, in stacking order, wherever it is picked', () => {
    useStore.getState().selectObjects(['B', 'D']);
    useStore.getState().groupSelection();

    useStore.getState().selectObject('A');
    useStore.getState().toggleSelectObject('D');
    expect(order()).toEqual(['A', 'B', 'D']);

    useStore.getState().selectObject('D');
    useStore.getState().toggleSelectObject('A');
    expect(order()).toEqual(['B', 'D', 'A']);
  });

  it('uses stacking order for Select All and for selecting an operation', () => {
    useStore.getState().selectObject('D');
    useStore.getState().selectAllObjects();
    expect(order()).toEqual(['A', 'B', 'C', 'D']);

    const operationId = useStore.getState().project.scene.layers[0]?.id ?? '';
    useStore.getState().assignSelectionToLayer(operationId);
    useStore.getState().selectObject('D');
    useStore.getState().selectObjectsOnLayer(operationId);
    expect(order()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('reconciles a stale record with a selection set some other way', () => {
    useStore.getState().selectObject('D');
    useStore.getState().toggleSelectObject('B');
    // Undo, paste and similar actions set the selection without a record.
    useStore.setState({ selectedObjectId: 'A', additionalSelectedIds: new Set(['B', 'C']) });

    expect(order()).toEqual(['B', 'A', 'C']);
  });

  it('sorts objects into pick order for the tools that need it', () => {
    useStore.getState().selectObject('C');
    useStore.getState().toggleSelectObject('A');
    const objects = useStore.getState().project.scene.objects;

    expect(inSelectionOrder(useStore.getState(), objects).map((object) => object.id)).toEqual([
      'C',
      'A',
      'B',
      'D',
    ]);
  });

  it('forgets the record when a new project starts', () => {
    useStore.getState().selectObject('C');
    useStore.getState().toggleSelectObject('A');

    useStore.getState().newProject();

    expect(useStore.getState().selectionOrder).toEqual([]);
  });
});

function order(): ReadonlyArray<string> {
  return orderedSelectionIds(useStore.getState());
}

function stackingSelection(): ReadonlyArray<string> {
  const state = useStore.getState();
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
}
