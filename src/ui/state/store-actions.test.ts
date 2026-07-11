// Undo/redo selection preservation (CNV-13). Undo/redo used to wipe the
// selection unconditionally, so undoing a nudge deselected everything and
// forced reselection on every tweak cycle. Now the prior selection survives
// as long as its ids still resolve to a live object in the restored scene.

import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

const MOVED_TRANSFORM = { ...IDENTITY_TRANSFORM, x: 50, y: 50 };

describe('useStore — undo/redo selection preservation (CNV-13)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('keeps a still-present object selected across undo', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    useStore.getState().applyObjectTransform('O1', MOVED_TRANSFORM); // pushes undo, keeps selection

    useStore.getState().undo();

    expect(useStore.getState().selectedObjectId).toBe('O1');
  });

  it('keeps a still-present object selected across redo', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    useStore.getState().applyObjectTransform('O1', MOVED_TRANSFORM);
    useStore.getState().undo();

    useStore.getState().redo();

    expect(useStore.getState().selectedObjectId).toBe('O1');
  });

  it('clears path-node selection on undo (indices reference the old geometry)', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    useStore.getState().applyObjectTransform('O1', MOVED_TRANSFORM);

    useStore.getState().undo();

    expect(useStore.getState().selectedPathNode).toBeNull();
    expect(useStore.getState().selectedPathNodes).toEqual([]);
  });
});
