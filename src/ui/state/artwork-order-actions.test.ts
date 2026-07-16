import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

afterEach(resetStore);

describe('artwork order actions', () => {
  it('moves artwork to a direct position without changing canvas stacking', () => {
    useStore.getState().importSvgObject(svgObj('Johann', ['#000000']));
    useStore.getState().importSvgObject(svgObj('Box', ['#000000']));
    useStore.getState().importSvgObject(svgObj('Badge', ['#000000']));
    useStore.getState().moveArtworkToPosition(['Box'], 1);

    const scene = useStore.getState().project.scene;
    expect(scene.artworkOrder).toEqual(['Box', 'Johann', 'Badge']);
    expect(scene.objects.map((object) => object.id)).toEqual(['Johann', 'Box', 'Badge']);
    expect(useStore.getState().undoStack).toHaveLength(4);
  });

  it('moves a multi-selection as stable artwork priorities', () => {
    for (const id of ['A', 'B', 'C', 'D'])
      useStore.getState().importSvgObject(svgObj(id, ['#000000']));
    useStore.getState().moveArtworkToPosition(['B', 'D'], 4);
    expect(useStore.getState().project.scene.artworkOrder).toEqual(['A', 'C', 'B', 'D']);
  });

  it('updates order during an interaction without adding another undo snapshot', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#000000']));
    useStore.getState().importSvgObject(svgObj('B', ['#000000']));
    useStore.getState().beginInteraction();

    useStore.getState().setArtworkOrderDuringInteraction(['B', 'A']);

    expect(useStore.getState().project.scene.artworkOrder).toEqual(['B', 'A']);
    expect(useStore.getState().undoStack).toHaveLength(2);
    useStore.getState().endInteraction();
    expect(useStore.getState().undoStack).toHaveLength(3);
  });
});
