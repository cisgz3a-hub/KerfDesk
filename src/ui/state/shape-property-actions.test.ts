import { beforeEach, describe, expect, it } from 'vitest';
import { createRectangle } from '../../core/shapes';
import { resetStore } from './test-helpers';
import { useStore } from './store';

beforeEach(() => resetStore());

describe('shape property actions', () => {
  it('rematerializes one selected shape as one undoable edit', () => {
    const rectangle = createRectangle({
      id: 'rect-1',
      color: '#ff0000',
      spec: { widthMm: 40, heightMm: 20, cornerRadiusMm: 0 },
    });
    useStore.getState().drawShape(rectangle);
    useStore.setState({ undoStack: [], redoStack: [] });

    useStore.getState().setSelectedShapeSpec({
      kind: 'rect',
      widthMm: 40,
      heightMm: 20,
      cornerRadiusMm: 5,
    });

    const state = useStore.getState();
    expect(state.project.scene.objects[0]).toMatchObject({
      id: 'rect-1',
      spec: { kind: 'rect', widthMm: 40, heightMm: 20, cornerRadiusMm: 5 },
    });
    expect(state.undoStack).toHaveLength(1);
    state.undo();
    expect(useStore.getState().project.scene.objects[0]).toEqual(rectangle);
  });

  it('does not edit a shape while multiple objects are selected', () => {
    const first = createRectangle({
      id: 'rect-1',
      color: '#ff0000',
      spec: { widthMm: 40, heightMm: 20, cornerRadiusMm: 0 },
    });
    const second = createRectangle({
      id: 'rect-2',
      color: '#00ff00',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    });
    useStore.getState().drawShape(first);
    useStore.getState().drawShape(second);
    useStore.setState({ selectedObjectId: first.id, additionalSelectedIds: new Set([second.id]) });

    useStore.getState().setSelectedShapeSpec({
      kind: 'rect',
      widthMm: 40,
      heightMm: 20,
      cornerRadiusMm: 5,
    });

    expect(useStore.getState().project.scene.objects[0]).toEqual(first);
  });
});
