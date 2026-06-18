import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type Project,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function raster(overrides: Partial<RasterImage> = {}): RasterImage {
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
    ...overrides,
  };
}

function project(): Project {
  const base = createProject();
  const mask = createRectangle({
    id: 'M1',
    color: '#000000',
    spec: { widthMm: 2, heightMm: 1, cornerRadiusMm: 0 },
  });
  return {
    ...base,
    scene: {
      objects: [raster(), mask],
      layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
    },
  };
}

describe('image mask actions', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().setProject(project());
  });

  it('applies and removes an image mask with undo support', () => {
    useStore.getState().applyImageMask('R1', 'M1');

    const masked = useStore.getState().project.scene.objects.find((object) => object.id === 'R1');
    expect(masked?.kind === 'raster-image' ? masked.imageMaskId : undefined).toBe('M1');
    expect(useStore.getState().dirty).toBe(true);

    useStore.getState().undo();
    const undone = useStore.getState().project.scene.objects.find((object) => object.id === 'R1');
    expect(undone?.kind === 'raster-image' ? undone.imageMaskId : undefined).toBeUndefined();

    useStore.getState().redo();
    useStore.getState().removeImageMask('R1');
    const unmasked = useStore.getState().project.scene.objects.find((object) => object.id === 'R1');
    expect(unmasked?.kind === 'raster-image' ? unmasked.imageMaskId : undefined).toBeUndefined();
  });
});
