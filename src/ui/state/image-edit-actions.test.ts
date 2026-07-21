import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function raster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
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

function project(): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      objects: [raster()],
      layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
    },
  };
}

function rasterById(id: string): RasterImage | undefined {
  const found = useStore.getState().project.scene.objects.find((object) => object.id === id);
  return found?.kind === 'raster-image' ? found : undefined;
}

describe('applyEditedImage', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().setProject(project());
  });

  it('swaps pixels as one undoable step, leaving dims and bounds untouched', () => {
    useStore
      .getState()
      .applyEditedImage('R1', { dataUrl: 'data:image/png;base64,edited', lumaBase64: 'BBB=' });

    const edited = rasterById('R1');
    expect(edited?.dataUrl).toBe('data:image/png;base64,edited');
    expect(edited?.lumaBase64).toBe('BBB=');
    expect(edited?.pixelWidth).toBe(2);
    expect(edited?.bounds).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 1 });
    expect(useStore.getState().dirty).toBe(true);

    useStore.getState().undo();
    expect(rasterById('R1')?.dataUrl).toBe('data:image/png;base64,source');
    useStore.getState().redo();
    expect(rasterById('R1')?.dataUrl).toBe('data:image/png;base64,edited');
  });

  it('ignores unknown or non-raster targets', () => {
    const before = useStore.getState().project;
    useStore.getState().applyEditedImage('nope', { dataUrl: 'x', lumaBase64: 'y' });
    expect(useStore.getState().project).toBe(before);
  });
});
