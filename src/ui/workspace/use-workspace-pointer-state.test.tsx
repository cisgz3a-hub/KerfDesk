import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useUiStore, type ToolMode } from '../state/ui-store';
import { DEFAULT_SNAP_SETTINGS } from './snap-settings';
import { cleanupTracePartHarness, pointer, renderHarness } from './trace-part-drag-test-harness';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetStore();
  useUiStore.setState({
    toolMode: { kind: 'select' },
    spaceDown: false,
    selectionMarquee: null,
    measureDraft: null,
    draftShape: null,
    snapSettings: { ...DEFAULT_SNAP_SETTINGS, enabled: false },
  });
});

afterEach(cleanupTracePartHarness);

const cases: ReadonlyArray<{
  readonly surface: 'selectionMarquee' | 'measureDraft' | 'draftShape';
  readonly mode: ToolMode;
}> = [
  { surface: 'selectionMarquee', mode: { kind: 'select' } },
  { surface: 'measureDraft', mode: { kind: 'measure' } },
  { surface: 'draftShape', mode: { kind: 'draw', shape: 'rect' } },
];

describe('workspace pointer document ownership', () => {
  it.each(cases)(
    'clears $surface on replacement without committing the old drag',
    async ({ surface, mode }) => {
      useUiStore.setState({ toolMode: mode });
      const canvas = await renderHarness();
      await pointer(canvas, 'pointerdown', { x: 20, y: 20 });
      await pointer(canvas, 'pointermove', { x: 40, y: 40 });
      expect(useUiStore.getState()[surface]).not.toBeNull();
      await act(async () => {
        useStore.getState().setProject(createProject());
      });
      const replacement = useStore.getState().project;
      expect(useUiStore.getState()[surface]).toBeNull();
      await pointer(canvas, 'pointermove', { x: 60, y: 60 });
      await pointer(canvas, 'pointerup', { x: 60, y: 60 });
      expect(useUiStore.getState()[surface]).toBeNull();
      expect(useStore.getState().project).toBe(replacement);
      expect(useStore.getState().undoStack).toEqual([]);
      expect(useStore.getState().pendingUndo).toBeNull();
      expect(canvas.releasePointerCapture).toHaveBeenCalledWith(3);
    },
  );
});
