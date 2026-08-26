import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

describe('interaction cancellation', () => {
  beforeEach(() => resetStore());

  it('restores project, history, dirty state, and selection exactly', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.setState({ dirty: false, redoStack: [createProject()] });
    const before = useStore.getState();
    const object = before.project.scene.objects[0];
    if (object === undefined) throw new Error('object missing');

    useStore.getState().beginInteraction();
    useStore.getState().setObjectTransform('O1', { ...object.transform, x: 25 });
    useStore.setState({
      selectedObjectId: null,
      additionalSelectedIds: new Set(['ghost']),
      undoStack: [],
      redoStack: [],
      dirty: true,
    });
    useStore.getState().cancelInteraction();

    const after = useStore.getState();
    expect(after.project).toBe(before.project);
    expect(after.undoStack).toBe(before.undoStack);
    expect(after.redoStack).toBe(before.redoStack);
    expect(after.dirty).toBe(before.dirty);
    expect(after.selectedObjectId).toBe(before.selectedObjectId);
    expect(after.additionalSelectedIds).toEqual(before.additionalSelectedIds);
    expect(after.pendingUndo).toBeNull();
  });
});
