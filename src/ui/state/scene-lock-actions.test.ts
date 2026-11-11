import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { resetStore, svgObj } from './test-helpers';
import { useStore } from './store';

describe('scene lock actions', () => {
  beforeEach(() => resetStore());

  it('locks the current selection as one undoable dirty edit and clears selection', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('B', ['#00ff00']));
    useStore.getState().selectObjects(['A', 'B']);
    useStore.setState({ undoStack: [], dirty: false });

    useStore.getState().lockSelection();

    const state = useStore.getState();
    expect(state.project.scene.objects.map((object) => object.locked)).toEqual([true, true]);
    expect(state.selectedObjectId).toBeNull();
    expect([...state.additionalSelectedIds]).toEqual([]);
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);

    useStore.getState().undo();

    expect(useStore.getState().project.scene.objects.map((object) => object.locked)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('unlocks every locked object as one undoable dirty edit', () => {
    useStore.getState().importSvgObject({ ...svgObj('A', ['#ff0000']), locked: true });
    useStore.getState().importSvgObject(svgObj('B', ['#00ff00']));
    useStore.setState({ undoStack: [], dirty: false });

    useStore.getState().unlockAllObjects();

    const state = useStore.getState();
    expect(state.project.scene.objects.map((object) => object.locked)).toEqual([
      undefined,
      undefined,
    ]);
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);
  });

  it('does not select locked objects by id, toggle, or select all', () => {
    useStore.getState().importSvgObject({ ...svgObj('A', ['#ff0000']), locked: true });
    useStore.getState().importSvgObject(svgObj('B', ['#00ff00']));

    useStore.getState().selectObject('A');
    expect(useStore.getState().selectedObjectId).toBeNull();

    useStore.getState().toggleSelectObject('A');
    expect(useStore.getState().selectedObjectId).toBeNull();

    useStore.getState().selectAllObjects();
    expect(useStore.getState().selectedObjectId).toBe('B');
    expect([...useStore.getState().additionalSelectedIds]).toEqual([]);
  });

  it('ignores stale transform writes against locked objects', () => {
    useStore.getState().importSvgObject({ ...svgObj('A', ['#ff0000']), locked: true });
    const before = useStore.getState().project.scene.objects[0]?.transform;

    useStore.getState().applyObjectTransform('A', { ...IDENTITY_TRANSFORM, x: 50, y: 50 });

    expect(useStore.getState().project.scene.objects[0]?.transform).toEqual(before);
  });
});

describe('unlocking one object (annoyance audit A4-P2-3)', () => {
  beforeEach(() => resetStore());

  it('unlocks only the named objects as one undoable dirty edit', () => {
    useStore.getState().importSvgObject({ ...svgObj('A', ['#ff0000']), locked: true });
    useStore.getState().importSvgObject({ ...svgObj('B', ['#00ff00']), locked: true });
    useStore.getState().importSvgObject({ ...svgObj('C', ['#0000ff']), locked: true });
    useStore.setState({ undoStack: [], dirty: false });

    useStore.getState().unlockObjects(['B']);

    const state = useStore.getState();
    expect(state.project.scene.objects.map((object) => object.locked)).toEqual([
      true,
      undefined,
      true,
    ]);
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);

    // The freed object can be selected again; its locked neighbours cannot.
    useStore.getState().selectObjects(['A', 'B', 'C']);
    expect(useStore.getState().selectedObjectId).toBe('B');
    expect([...useStore.getState().additionalSelectedIds]).toEqual([]);

    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects.map((object) => object.locked)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('changes nothing, and adds no undo step, for unlocked or unknown objects', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.setState({ undoStack: [], dirty: false });
    const before = useStore.getState().project;

    useStore.getState().unlockObjects(['A']);
    useStore.getState().unlockObjects(['missing']);
    useStore.getState().unlockObjects([]);

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
  });
});
