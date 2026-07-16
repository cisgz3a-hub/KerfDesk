import { afterEach, describe, expect, it } from 'vitest';
import { useUiStore } from './ui-store';

afterEach(() => {
  useUiStore.getState().finishArtworkNumbering();
  useUiStore.getState().setArtworkRunFocus(null);
});

describe('artwork run order UI state', () => {
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
