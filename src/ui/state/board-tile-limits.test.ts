// Array on board and the project's limits (ADR-307 amendment 1). Tiling adds
// up to MAX_TILE_TOTAL - 1 copies of the design. A project past
// PROJECT_SCENE_LIMITS saves but cannot be opened again, so tiling that would
// take it past one is refused with a notice and changes nothing, and tiling
// that fits is made exactly as before.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Project, TileLayout } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import {
  currentProject,
  expectUnchanged,
  lastToast,
  loadScene,
  OBJECT_LIMIT,
  pastTheLimit,
  rect,
  rects,
} from './testing/scene-limit-fixtures';
import { useToastStore } from './toast-store';

const ASK = 'Array fewer copies on the board, or delete some objects first.';
const TWO_BY_TWO: TileLayout = { kind: 'grid', rows: 2, cols: 2, gapXMm: 0, gapYMm: 0 };

// A placed 300 mm board, the design selected on it, and `others` other
// objects: `others` + 2 objects, with nothing to undo.
function loadBoard(others: number): Project {
  loadScene([rect('design'), ...rects(others)], ['design']);
  useStore.getState().addCapturedBoardBox(300, 300);
  useStore.setState({
    selectedObjectId: 'design',
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  return currentProject();
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Array on board and the project limits', () => {
  it('refuses to fill the board with more copies than the project can hold', () => {
    // A 10 x 5 mm design fills the board with 465 copies in all: 464 more
    // objects would take 9,702 to 10,166.
    const before = loadBoard(9_700);

    useStore.getState().tileSelectionIntoBoard({ kind: 'fill', gapXMm: 0, gapYMm: 0 });

    expectUnchanged(before);
    expect(useStore.getState().selectedObjectId).toBe('design');
    expect(lastToast()).toEqual({
      message: pastTheLimit('objects', OBJECT_LIMIT, ASK),
      variant: 'warning',
    });
  });

  it('tiles to exactly the limit, as before, in one undo step', () => {
    // Four tiles add three copies: 9,998 objects would become 10,001.
    const full = loadBoard(OBJECT_LIMIT - 4);
    useStore.getState().tileSelectionIntoBoard(TWO_BY_TWO);
    expectUnchanged(full);
    expect(lastToast()?.message).toBe(pastTheLimit('objects', OBJECT_LIMIT, ASK));

    useToastStore.setState({ toasts: [] });
    const before = loadBoard(OBJECT_LIMIT - 5);
    useStore.getState().tileSelectionIntoBoard(TWO_BY_TWO);
    expect(currentProject().scene.objects).toHaveLength(OBJECT_LIMIT);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().additionalSelectedIds.size).toBe(3);
    expect(lastToast()).toBeUndefined();
    expect(deserializeProject(serializeProject(currentProject())).kind).toBe('ok');
  });
});
