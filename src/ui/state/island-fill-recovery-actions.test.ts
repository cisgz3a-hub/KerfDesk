import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject } from '../../core/scene';
import { useStore } from './store';
import { resetStore as reset } from './test-helpers';

describe('Island Fill recovery actions', () => {
  beforeEach(() => reset());

  it('switchIslandFillLayersToScanline patches only Island Fill layers and is undoable', () => {
    useStore.setState({
      project: {
        ...createProject(),
        scene: {
          objects: [],
          layers: [
            {
              ...createLayer({ id: 'island', color: '#ff0000', mode: 'fill' }),
              fillStyle: 'island',
            },
            {
              ...createLayer({ id: 'scanline', color: '#00ff00', mode: 'fill' }),
              fillStyle: 'scanline',
            },
            createLayer({ id: 'line', color: '#0000ff', mode: 'line' }),
          ],
        },
      },
      dirty: false,
      undoStack: [],
    });

    useStore.getState().switchIslandFillLayersToScanline();

    expect(useStore.getState().project.scene.layers.map((layer) => layer.fillStyle)).toEqual([
      'scanline',
      'scanline',
      'scanline',
    ]);
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();

    expect(useStore.getState().project.scene.layers.map((layer) => layer.fillStyle)).toEqual([
      'island',
      'scanline',
      'scanline',
    ]);
  });
});
