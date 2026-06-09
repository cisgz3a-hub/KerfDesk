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
});
