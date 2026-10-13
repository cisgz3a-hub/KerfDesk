import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import {
  editShortcutContext,
  TOOL_SHORTCUT_CONTEXT,
  transformShortcutContext,
} from './shortcut-contexts';
import { handleEditShortcut, handleTransformShortcut } from './shortcuts';

const initialApp = useStore.getState();
const initialUi = useUiStore.getState();

afterEach(() => {
  useStore.setState(initialApp, true);
  useUiStore.setState(initialUi, true);
});

describe('Alt+T Trace Image shortcut context', () => {
  it('opens Trace Image on the selected image', () => {
    useStore.setState({ project: projectWithRasterAndPath(), selectedObjectId: 'R1' });

    TOOL_SHORTCUT_CONTEXT.openTraceImage();

    expect(useUiStore.getState().imageDialog?.source.id).toBe('R1');
  });

  it('does nothing without a selected image, like the disabled Tools command', () => {
    useStore.setState({ project: projectWithRasterAndPath(), selectedObjectId: 'P1' });
    TOOL_SHORTCUT_CONTEXT.openTraceImage();
    useStore.setState({ selectedObjectId: null });
    TOOL_SHORTCUT_CONTEXT.openTraceImage();

    expect(useUiStore.getState().imageDialog).toBeNull();
  });
});

describe('leaving node editing', () => {
  it.each(['select', 'trace-parts', 'measure'] as const)(
    'makes Arrow and Delete act on the object after switching to %s',
    (kind) => {
      const nudgeSelectedPathNode = vi.fn();
      const nudgeSelection = vi.fn();
      const deleteSelectedPathNodes = vi.fn();
      const removeSceneObjects = vi.fn();
      useStore.setState({
        selectedObjectId: 'P1',
        selectedPathNode: { objectId: 'P1', pathIndex: 0, polylineIndex: 0, pointIndex: 0 },
        nudgeSelectedPathNode,
        nudgeSelection,
        deleteSelectedPathNodes,
        removeSceneObjects,
      });
      useUiStore.getState().setToolMode({ kind: 'node' });
      const nudge = (): boolean =>
        handleTransformShortcut(
          new KeyboardEvent('keydown', { key: 'ArrowRight' }),
          transformShortcutContext(),
        );
      const remove = (): boolean =>
        handleEditShortcut(new KeyboardEvent('keydown', { key: 'Delete' }), editShortcutContext());

      expect(nudge()).toBe(true);
      expect(remove()).toBe(true);
      expect(nudgeSelectedPathNode).toHaveBeenCalledTimes(1);
      expect(deleteSelectedPathNodes).toHaveBeenCalledTimes(1);
      expect(nudgeSelection).not.toHaveBeenCalled();
      expect(removeSceneObjects).not.toHaveBeenCalled();

      if (kind === 'select') useUiStore.getState().resetToolMode();
      else useUiStore.getState().setToolMode({ kind });

      expect(nudge()).toBe(true);
      expect(remove()).toBe(true);
      expect(nudgeSelection).toHaveBeenCalledTimes(1);
      expect(removeSceneObjects).toHaveBeenCalledWith(['P1']);
      expect(nudgeSelectedPathNode).toHaveBeenCalledTimes(1);
      expect(deleteSelectedPathNodes).toHaveBeenCalledTimes(1);
    },
  );
});

function projectWithRasterAndPath(): Project {
  return {
    ...createProject(),
    scene: {
      layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
      objects: [
        {
          kind: 'raster-image',
          id: 'R1',
          source: 'logo.png',
          dataUrl: 'data:image/png;base64,logo',
          pixelWidth: 2,
          pixelHeight: 1,
          bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
          transform: IDENTITY_TRANSFORM,
          color: '#808080',
          dither: 'threshold',
          linesPerMm: 10,
        },
        // A trace result: selectable, but not an image Trace can run on. Only
        // its kind matters to the gate.
        {
          kind: 'traced-image',
          id: 'P1',
          source: 'logo.png',
          paths: [],
          bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
          transform: IDENTITY_TRANSFORM,
          color: '#808080',
        },
      ],
    },
  } as unknown as Project;
}
