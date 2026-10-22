import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canonicalArtworkOrder } from '../../core/artwork-order';
import { addObject } from '../../core/scene';
import { useStore, type AppState } from './store';
import { pushUndo } from './scene-mutations';
import { resetStore, svgObj } from './test-helpers';
import { useUiStore } from './ui-store';

// Canvas numbering refuses edits that would land inside its interaction. A
// caller of commitProjectEdit must not then close its dialog as if it applied.

beforeEach(() => {
  resetStore();
  useStore.getState().importSvgObject(svgObj('first', ['#000000']));
});
afterEach(() => {
  if (useUiStore.getState().artworkNumbering.kind === 'active') {
    useStore.getState().cancelInteraction();
    useUiStore.getState().finishArtworkNumbering();
  }
  resetStore();
});

const addArtwork = (state: AppState): Partial<AppState> => ({
  project: {
    ...state.project,
    scene: addObject(state.project.scene, svgObj('second', ['#000000'])),
  },
  undoStack: pushUndo(state.project, state.undoStack),
  redoStack: [],
  dirty: true,
});

it('reports no commit, and runs no onCommitted, when canvas numbering refuses the edit', () => {
  useStore.getState().beginInteraction();
  useUiStore
    .getState()
    .startArtworkNumbering(canonicalArtworkOrder(useStore.getState().project.scene));
  const before = useStore.getState().project;
  const onCommitted = vi.fn();

  expect(useStore.getState().commitProjectEdit(addArtwork, onCommitted)).toBe(false);
  expect(onCommitted).not.toHaveBeenCalled();
  expect(useStore.getState().project).toBe(before);

  useStore.getState().endInteraction();
  useUiStore.getState().finishArtworkNumbering();
  expect(useStore.getState().commitProjectEdit(addArtwork, onCommitted)).toBe(true);
  expect(onCommitted).toHaveBeenCalledOnce();
  expect(useStore.getState().project.scene.objects.map((object) => object.id)).toContain('second');
});
