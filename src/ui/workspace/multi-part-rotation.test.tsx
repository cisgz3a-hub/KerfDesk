import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { DEFAULT_SNAP_SETTINGS } from './snap-settings';
import { selectionRotateAnchor, selectionRotateHandlePosition } from './rotate-handle';
import { cleanupTracePartHarness, pointer, renderHarness } from './trace-part-drag-test-harness';
import { getTrace, loadTrace } from './trace-part-test-fixtures';
import { computeView } from './view-transform';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetStore();
  useUiStore.setState({
    toolMode: { kind: 'trace-parts' },
    spaceDown: false,
    snapSettings: { ...DEFAULT_SNAP_SETTINGS, enabled: false },
  });
});
afterEach(cleanupTracePartHarness);

describe('multi-part rotation through the pointer pipeline', () => {
  it.each([false, true])(
    'rotates both selected contours without deselecting either (Shift=%s)',
    async (shiftKey) => {
      loadTrace();
      const canvas = await renderHarness(true);
      for (const x of [30, 110]) {
        await pointer(canvas, 'pointerdown', { x, y: 55 }, { shiftKey: true });
        await pointer(canvas, 'pointerup', { x, y: 55 }, { shiftKey: true });
      }
      const before = useStore.getState();
      if (before.selectedObjectId === null) throw new Error('Expected both selected parts');
      const ids = [before.selectedObjectId, ...before.additionalSelectedIds];
      const objects = ids.map(getTrace);
      const remainder = getTrace('trace').transform;
      const device = before.project.device;
      const view = computeView(canvas.width, canvas.height, device.bedWidth, device.bedHeight);
      const grab = selectionRotateHandlePosition(objects, 1 / view.scale);
      const anchor = selectionRotateAnchor(objects);
      if (grab === null || anchor === null) throw new Error('Expected rotation handle');
      const target = { x: anchor.x + anchor.y - grab.y, y: anchor.y };
      await pointer(canvas, 'pointerdown', grab, { shiftKey });
      await pointer(canvas, 'pointermove', target, { shiftKey });
      await pointer(canvas, 'pointerup', target, { shiftKey });
      const after = useStore.getState();
      expect([after.selectedObjectId, ...after.additionalSelectedIds]).toEqual(ids);
      expect(ids.map((id) => getTrace(id).transform.rotationDeg)).toEqual([90, 90]);
      expect(getTrace('trace').transform).toEqual(remainder);
      expect(after.undoStack).toHaveLength(before.undoStack.length + 1);
      await act(async () => useStore.getState().undo());
      expect(useStore.getState().project).toEqual(before.project);
    },
  );
});
