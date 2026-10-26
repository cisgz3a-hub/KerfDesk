import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canonicalArtworkOrder } from '../../core/artwork-order';
import { deserializeProject } from '../../io/project';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { saveProjectNow } from './confirm-discard';

beforeEach(() => {
  resetStore();
  useStore.getState().importSvgObject(svgObj('A', ['#000000']));
  useStore.getState().importSvgObject(svgObj('B', ['#000000']));
  useStore.setState({ dirty: false });
  useStore.getState().beginInteraction();
  useUiStore.getState().startArtworkNumbering(['A', 'B']);
  useStore.getState().setArtworkOrderDuringInteraction(['B', 'A']);
});
afterEach(() => {
  useUiStore.getState().resetArtworkRunOrder();
  resetStore();
});

it('commits numbering before the save picker and cannot roll back a successfully saved order', async () => {
  let saved = '';
  const target = {
    displayName: 'numbered.lf2',
    write: async (contents: string | Blob) => {
      if (typeof contents !== 'string') throw new Error('Expected project JSON');
      saved = contents;
    },
  };
  const picker = vi.fn(async () => {
    expect(useStore.getState().pendingUndo).toBeNull();
    expect(useUiStore.getState().artworkNumbering.kind).not.toBe('active');
    // A queued Cancel from the retired panel cannot restore its old snapshot.
    useStore.getState().cancelInteraction();
    return target;
  });
  expect(await saveProjectNow(mockPlatform({ save: picker }))).toBe('saved');
  expect(picker).toHaveBeenCalledOnce();
  const disk = deserializeProject(saved);
  if (disk.kind !== 'ok') throw new Error(disk.kind);
  expect(canonicalArtworkOrder(disk.project.scene)).toEqual(['B', 'A']);
  useStore.getState().cancelInteraction();
  expect(canonicalArtworkOrder(useStore.getState().project.scene)).toEqual(['B', 'A']);
  expect(useStore.getState().dirty).toBe(false);
  expect(useStore.getState().lastSaveTarget).toBe(target);
  useStore.getState().undo();
  expect(canonicalArtworkOrder(useStore.getState().project.scene)).toEqual(['A', 'B']);
  expect(useStore.getState().dirty).toBe(true);
});

it('keeps the committed numbering undoable and dirty if the save picker is cancelled', async () => {
  const before = useStore.getState().undoStack.length;
  expect(await saveProjectNow(mockPlatform({ save: async () => null }))).toBe('cancelled');
  expect(useStore.getState().pendingUndo).toBeNull();
  expect(useStore.getState().undoStack).toHaveLength(before + 1);
  expect(useStore.getState().dirty).toBe(true);
  expect(canonicalArtworkOrder(useStore.getState().project.scene)).toEqual(['B', 'A']);
  useStore.getState().undo();
  expect(canonicalArtworkOrder(useStore.getState().project.scene)).toEqual(['A', 'B']);
});
