import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, type Project } from '../../core/scene';
import { useUiStore } from '../state/ui-store';
import {
  commitDraftShape,
  DEFAULT_SHAPE_COLOR,
  drawModifiersFromEvent,
  draftForDrawDrag,
} from './draw-tool';
import type { DragState } from './drag-state';

const DRAG: Extract<DragState, { kind: 'draw' }> = {
  kind: 'draw',
  shape: 'rect',
  startScenePoint: { x: 0, y: 0 },
};

describe('draftForDrawDrag', () => {
  beforeEach(() => {
    useUiStore.getState().setActiveLayerColor(null);
    useUiStore.getState().setDraftShape(null);
    useUiStore.getState().setToolMode({ kind: 'select' });
  });

  it('uses the current drawing layer color when it still exists in the project', () => {
    useUiStore.getState().setActiveLayerColor('#00ff00');

    const draft = draftForDrawDrag(DRAG, { x: 10, y: 5 }, twoLayerProject());

    expect(draft?.color).toBe('#00ff00');
    expect(draft?.paths[0]?.color).toBe('#00ff00');
  });

  it('falls back to the first layer when the current drawing layer is stale', () => {
    useUiStore.getState().setActiveLayerColor('#0000ff');

    const draft = draftForDrawDrag(DRAG, { x: 10, y: 5 }, twoLayerProject());

    expect(draft?.color).toBe('#ff0000');
  });

  it('falls back to the default shape color when the scene has no layers', () => {
    const draft = draftForDrawDrag(DRAG, { x: 10, y: 5 }, createProject());

    expect(draft?.color).toBe(DEFAULT_SHAPE_COLOR);
  });

  it('passes shape modifiers into the draft geometry', () => {
    const draft = draftForDrawDrag(DRAG, { x: 30, y: 10 }, twoLayerProject(), {
      regular: true,
    });

    expect(draft?.spec).toEqual({ kind: 'rect', widthMm: 30, heightMm: 30, cornerRadiusMm: 0 });
  });
});

describe('commitDraftShape', () => {
  beforeEach(() => {
    useUiStore.getState().setActiveLayerColor(null);
    useUiStore.getState().setDraftShape(null);
    useUiStore.getState().setToolMode({ kind: 'select' });
  });

  it('commits the current draft and returns to Select mode', () => {
    const drawShape = vi.fn();
    const draft = draftForDrawDrag(DRAG, { x: 10, y: 5 }, twoLayerProject());
    useUiStore.getState().setDraftShape(draft);
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'rect' });

    expect(commitDraftShape(drawShape)).toBe(true);

    expect(drawShape).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().draftShape).toBeNull();
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
  });

  it('does not leave draw mode on a no-op click with no significant draft', () => {
    const drawShape = vi.fn();
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'rect' });

    expect(commitDraftShape(drawShape)).toBe(false);

    expect(drawShape).not.toHaveBeenCalled();
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'draw', shape: 'rect' });
  });
});

describe('drawModifiersFromEvent', () => {
  it('maps Shift to regular shape creation', () => {
    expect(drawModifiersFromEvent({ shiftKey: true, ctrlKey: false, metaKey: false })).toEqual({
      regular: true,
      fromCenter: false,
    });
  });

  it('maps Ctrl/Cmd to center-out shape creation', () => {
    expect(drawModifiersFromEvent({ shiftKey: false, ctrlKey: true, metaKey: false })).toEqual({
      regular: false,
      fromCenter: true,
    });
    expect(drawModifiersFromEvent({ shiftKey: false, ctrlKey: false, metaKey: true })).toEqual({
      regular: false,
      fromCenter: true,
    });
  });
});

function twoLayerProject(): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      objects: [],
      layers: [
        createLayer({ id: '#ff0000', color: '#ff0000', mode: 'line' }),
        createLayer({ id: '#00ff00', color: '#00ff00', mode: 'line' }),
      ],
    },
  };
}
