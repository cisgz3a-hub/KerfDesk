import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer, type Scene } from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

beforeEach(() => {
  resetStore();
});

describe('generated scene actions', () => {
  it('replaces the current scene with undo and clears selection', () => {
    useStore.getState().importSvgObject(svgObj('old', ['#ff0000']));
    useStore.getState().selectObject('old');
    useStore.setState({ undoStack: [], redoStack: [] });
    const scene: Scene = {
      layers: [
        { ...createLayer({ id: 'generated', color: '#100000', mode: 'fill' }), speed: 3000 },
      ],
      objects: [svgObj('generated-cell', ['#100000'])],
    };

    useStore.getState().replaceSceneWithGeneratedScene(scene);

    expect(useStore.getState().project.scene).toBe(scene);
    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('inserts generated artwork beside the design, selects it, and undoes in one step', () => {
    useStore.getState().importSvgObject(svgObj('old', ['#ff0000']));
    useStore.getState().selectObject('old');
    useStore.setState({ undoStack: [], redoStack: [] });
    const before = useStore.getState().project.scene;
    const scene: Scene = {
      ...before,
      layers: [...before.layers, createLayer({ id: 'test-op', color: '#100000', mode: 'fill' })],
      objects: [...before.objects, svgObj('cell-a', ['#100000']), svgObj('cell-b', ['#100000'])],
    };

    useStore.getState().insertGeneratedScene(scene, ['cell-a', 'cell-b']);

    const state = useStore.getState();
    expect(state.project.scene.objects.map((object) => object.id)).toEqual([
      'old',
      'cell-a',
      'cell-b',
    ]);
    expect(state.selectedObjectId).toBe('cell-a');
    expect([...state.additionalSelectedIds]).toEqual(['cell-b']);
    expect(state.dirty).toBe(true);
    expect(state.undoStack).toHaveLength(1);

    useStore.getState().undo();
    expect(useStore.getState().project.scene).toBe(before);
  });
});
