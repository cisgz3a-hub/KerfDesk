import { afterEach, describe, expect, it } from 'vitest';
import { useUiStore } from './ui-store';

afterEach(() => {
  useUiStore.getState().finishArtworkNumbering();
  useUiStore.getState().setArtworkRunFocus(null);
});

describe('artwork run order UI state', () => {
  it('resets document numbering and focus without changing operator UI preferences', () => {
    const preferences = {
      zoomFactor: 4,
      panX: 10,
      panY: 20,
      previewPlaybackSpeed: 'fast' as const,
      showPreviewTravel: false,
      cutsLayersView: 'run-order' as const,
    };
    useUiStore.setState(preferences);
    useUiStore.getState().startArtworkNumbering(['A', 'B']);
    useUiStore.getState().setArtworkRunFocus({
      objectIds: ['A'],
      position: 1,
      color: '#000000',
    });

    useUiStore.getState().resetArtworkRunOrder();

    expect(useUiStore.getState().artworkNumbering).toEqual({ kind: 'idle' });
    expect(useUiStore.getState().artworkRunFocus).toBeNull();
    expect(useUiStore.getState()).toMatchObject(preferences);
  });

  it('tracks a reversible canvas-numbering session', () => {
    useUiStore.getState().startArtworkNumbering(['A', 'B']);
    useUiStore
      .getState()
      .recordArtworkNumbering('B', ['B', 'A'], { objectIds: ['B'], position: 1, color: '#dc2626' });

    expect(useUiStore.getState().artworkNumbering).toMatchObject({
      kind: 'active',
      nextPosition: 2,
      assignedUnitKeys: ['B'],
    });
    useUiStore.getState().undoArtworkNumbering();
    expect(useUiStore.getState().artworkNumbering).toMatchObject({
      kind: 'active',
      nextPosition: 1,
      assignedUnitKeys: [],
    });
    expect(useUiStore.getState().artworkRunFocus).toBeNull();
  });
});
