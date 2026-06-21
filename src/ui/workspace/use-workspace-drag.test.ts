import { beforeEach, describe, expect, it } from 'vitest';
import { createRectangle } from '../../core/shapes';
import { useUiStore } from '../state/ui-store';
import { finishDrawToolOnRightDoubleClick } from './use-workspace-drag';

describe('finishDrawToolOnRightDoubleClick', () => {
  beforeEach(() => {
    useUiStore.getState().setToolMode({ kind: 'select' });
    useUiStore.getState().setDraftShape(null);
    useUiStore.getState().closeWorkspaceContextBar();
  });

  it('cancels draw mode, clears the draft, and returns to Select on a right double-click', () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'rect' });
    useUiStore.getState().setDraftShape(
      createRectangle({
        id: 'draft',
        color: '#000000',
        spec: { widthMm: 12, heightMm: 8, cornerRadiusMm: 0 },
      }),
    );
    useUiStore.getState().openWorkspaceContextBar({
      x: 100,
      y: 100,
      context: 'workspace-empty',
    });

    expect(finishDrawToolOnRightDoubleClick({ button: 2, detail: 2 })).toBe(true);

    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
    expect(useUiStore.getState().draftShape).toBeNull();
    expect(useUiStore.getState().workspaceContextBar).toBeNull();
  });

  it('leaves draw mode alone on a single right-click', () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'ellipse' });

    expect(finishDrawToolOnRightDoubleClick({ button: 2, detail: 1 })).toBe(false);

    expect(useUiStore.getState().toolMode).toEqual({ kind: 'draw', shape: 'ellipse' });
  });
});
