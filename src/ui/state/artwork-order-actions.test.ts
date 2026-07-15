import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

afterEach(resetStore);

describe('artwork order actions', () => {
  it('moves selected artwork priority without changing canvas stacking', () => {
    useStore.getState().importSvgObject(svgObj('Johann', ['#000000']));
    useStore.getState().importSvgObject(svgObj('Box', ['#000000']));
    useStore.getState().importSvgObject(svgObj('Badge', ['#000000']));
    useStore.setState({ selectedObjectId: 'Box', additionalSelectedIds: new Set() });

    useStore.getState().moveSelectedArtwork('first');

    const scene = useStore.getState().project.scene;
    expect(scene.artworkOrder).toEqual(['Box', 'Johann', 'Badge']);
    expect(scene.objects.map((object) => object.id)).toEqual(['Johann', 'Box', 'Badge']);
    expect(useStore.getState().undoStack).toHaveLength(4);
  });

  it('moves a multi-selection as stable artwork priorities', () => {
    for (const id of ['A', 'B', 'C', 'D'])
      useStore.getState().importSvgObject(svgObj(id, ['#000000']));
    useStore.setState({ selectedObjectId: 'B', additionalSelectedIds: new Set(['D']) });

    useStore.getState().moveSelectedArtwork('earlier');
    expect(useStore.getState().project.scene.artworkOrder).toEqual(['B', 'A', 'D', 'C']);

    useStore.getState().moveSelectedArtwork('last');
    expect(useStore.getState().project.scene.artworkOrder).toEqual(['A', 'C', 'B', 'D']);
  });
});
