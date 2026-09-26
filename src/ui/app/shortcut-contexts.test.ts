import { afterEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { TOOL_SHORTCUT_CONTEXT } from './shortcut-contexts';

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
