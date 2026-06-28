import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore as reset, svgObj } from './test-helpers';

describe('useStore multi-select', () => {
  beforeEach(() => reset());

  it('selectObject replaces both primary and additional', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#f00']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0f0']));
    useStore.setState({ additionalSelectedIds: new Set(['O2']) });
    useStore.getState().selectObject('O1');
    expect(useStore.getState().selectedObjectId).toBe('O1');
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
  });

  it('toggleSelectObject adds a new object to the multi-set', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#f00']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0f0']));
    useStore.getState().selectObject('O1');
    useStore.getState().toggleSelectObject('O2');
    expect(useStore.getState().selectedObjectId).toBe('O1');
    expect(useStore.getState().additionalSelectedIds.has('O2')).toBe(true);
  });

  it('toggleSelectObject removes the primary when only primary was selected', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#f00']));
    useStore.getState().selectObject('O1');
    useStore.getState().toggleSelectObject('O1');
    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
  });

  it('selectAllObjects puts every object into the selection', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#f00']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0f0']));
    useStore.getState().importSvgObject(svgObj('O3', ['#00f']));
    useStore.getState().selectAllObjects();
    const s = useStore.getState();
    expect(s.selectedObjectId).toBe('O1');
    expect(s.additionalSelectedIds.size).toBe(2);
    expect(s.additionalSelectedIds.has('O2')).toBe(true);
    expect(s.additionalSelectedIds.has('O3')).toBe(true);
  });

  it('removeSceneObject removes from BOTH primary and additional', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#f00']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0f0']));
    useStore.setState({ selectedObjectId: 'O1', additionalSelectedIds: new Set(['O2']) });
    useStore.getState().removeSceneObject('O2');
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
  });

  it('removeSceneObjects deletes a multi-selection as one undoable action', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#00ff00']));
    useStore.setState({
      selectedObjectId: 'O1',
      additionalSelectedIds: new Set(['O2']),
      undoStack: [],
      dirty: false,
    });

    useStore.getState().removeSceneObjects(['O1', 'O2']);

    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().project.scene.layers).toHaveLength(0);
    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();

    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'O1',
      'O2',
    ]);
    expect(
      useStore
        .getState()
        .project.scene.layers.map((layer) => layer.color)
        .sort(),
    ).toEqual(['#00ff00', '#ff0000']);
  });
});
