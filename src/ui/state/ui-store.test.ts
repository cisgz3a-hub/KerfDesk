import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from './ui-store';

const ONE_VERTEX = { vertices: [{ x: 1, y: 2 }], cursor: null };

describe('ui-store pen draft lifecycle (ADR-051 B6)', () => {
  beforeEach(() => {
    useUiStore.getState().setToolMode({ kind: 'select' });
    useUiStore.getState().setPenDraft(null);
  });

  it('setToolMode clears the pen draft when switching to a non-pen draw tool', () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    useUiStore.getState().setPenDraft(ONE_VERTEX);
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'rect' });
    expect(useUiStore.getState().penDraft).toBeNull();
  });

  it('setToolMode clears the pen draft when switching to Select', () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    useUiStore.getState().setPenDraft(ONE_VERTEX);
    useUiStore.getState().setToolMode({ kind: 'select' });
    expect(useUiStore.getState().penDraft).toBeNull();
  });

  it('setToolMode keeps the pen draft when the pen is re-selected', () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    useUiStore.getState().setPenDraft(ONE_VERTEX);
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    expect(useUiStore.getState().penDraft).toEqual(ONE_VERTEX);
  });

  it('resetToolMode returns to Select and clears the pen draft', () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    useUiStore.getState().setPenDraft(ONE_VERTEX);
    useUiStore.getState().resetToolMode();
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
    expect(useUiStore.getState().penDraft).toBeNull();
  });
});
