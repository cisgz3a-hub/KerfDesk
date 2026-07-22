import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { useStore } from '../state';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { openEditorForSelectedObject } from './open-selected-object-editor';

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
  openEditorSpy = vi.fn();
  useImageEditorStore.setState({ openEditor: openEditorSpy });
});

describe('openEditorForSelectedObject (canvas double-click)', () => {
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
