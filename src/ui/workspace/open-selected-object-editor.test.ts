import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type TextObject,
} from '../../core/scene';
import { useStore } from '../state';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { openEditorForSelectedObject } from './open-selected-object-editor';
import { useCanvasTextStore } from '../text/canvas-text-store';
import { useUiStore } from '../state/ui-store';
import { resetStore } from '../state/test-helpers';

function raster(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: 'source.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: 'AAA=',
  };
}

function projectWithRaster(): Project {
  return {
    ...createProject(),
    scene: { objects: [raster('R1')], layers: [createLayer({ id: 'L1', color: '#808080' })] },
  };
}

let openEditorSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetStore();
  useCanvasTextStore.getState().close();
  useUiStore.setState({ textDialog: null, imageDialog: null, modalDepth: 0 });
  openEditorSpy = vi.fn();
  useImageEditorStore.setState({ openEditor: openEditorSpy });
});

describe('openEditorForSelectedObject (canvas double-click)', () => {
  it('opens text on canvas without the Add Text dialog or a geometry mutation', () => {
    const object = text();
    const project = { ...createProject(), scene: { objects: [object], layers: [] } };
    useStore.setState({ project, selectedObjectId: object.id });

    openEditorForSelectedObject();

    expect(useCanvasTextStore.getState().session?.original).toBe(object);
    expect(useUiStore.getState().textDialog).toBeNull();
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it.each(['preview', 'locked', 'modal'] as const)('does not edit text in %s state', (reason) => {
    const object = { ...text(), locked: reason === 'locked' };
    useStore.setState({
      project: { ...createProject(), scene: { objects: [object], layers: [] } },
      selectedObjectId: object.id,
      previewMode: reason === 'preview',
    });
    if (reason === 'modal') useUiStore.setState({ modalDepth: 1 });

    openEditorForSelectedObject();

    expect(useCanvasTextStore.getState().session).toBeNull();
  });

  it('opens a double-clicked raster image in the Image Studio', () => {
    useStore.setState({ project: projectWithRaster(), selectedObjectId: 'R1' });
    openEditorForSelectedObject();
    expect(openEditorSpy).toHaveBeenCalledTimes(1);
    expect(openEditorSpy.mock.calls[0]?.[0]?.id).toBe('R1');
    expect(openEditorSpy.mock.calls[0]?.[0]?.kind).toBe('raster-image');
  });

  it('does nothing when no object is selected', () => {
    useStore.setState({ project: projectWithRaster(), selectedObjectId: null });
    openEditorForSelectedObject();
    expect(openEditorSpy).not.toHaveBeenCalled();
  });

  it('does nothing when the selected id matches no object', () => {
    useStore.setState({ project: projectWithRaster(), selectedObjectId: 'missing' });
    openEditorForSelectedObject();
    expect(openEditorSpy).not.toHaveBeenCalled();
  });
});

function text(): TextObject {
  return {
    kind: 'text',
    id: 'text',
    content: 'Hello',
    fontKey: 'roboto',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#ff0000',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
}
