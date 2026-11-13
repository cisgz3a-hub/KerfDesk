// Tools audit T1, T18-P2-1: after Apply Mask the image and its mask stay
// selected, and the primary selection is the first in scene order. Crop,
// Flatten and Remove Image Mask must find the one masked image either way.
import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { selectedMaskedImage } from './image-mask-command-state';

function photo(id: string, maskId?: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 1,
    lumaBase64: 'AP8=',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 10,
    ...(maskId === undefined ? {} : { imageMaskId: maskId }),
  };
}

const circle = {
  kind: 'imported-svg',
  id: 'M',
  source: 'circle.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [],
} as unknown as ImportedSvg;

function projectWith(objects: ReadonlyArray<SceneObject>): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, objects } };
}

const find = (project: Project, id: string) =>
  project.scene.objects.find((object) => object.id === id) ?? null;

describe('selectedMaskedImage (T18-P2-1)', () => {
  it('finds the masked image when the mask comes first in scene order and is primary', () => {
    const project = projectWith([circle, photo('R', 'M')]);
    expect(selectedMaskedImage(project, find(project, 'M'), ['M', 'R'])?.id).toBe('R');
  });

  it('uses the primary selection when it is the masked image', () => {
    const project = projectWith([photo('R', 'M'), circle]);
    expect(selectedMaskedImage(project, find(project, 'R'), ['R', 'M'])?.id).toBe('R');
  });

  it('finds nothing when no selected image has a mask', () => {
    const project = projectWith([circle, photo('R')]);
    expect(selectedMaskedImage(project, find(project, 'M'), ['M', 'R'])).toBeNull();
  });

  it('does not guess between two masked images when the primary is neither', () => {
    const project = projectWith([circle, photo('A', 'M'), photo('B', 'M')]);
    expect(selectedMaskedImage(project, find(project, 'M'), ['M', 'A', 'B'])).toBeNull();
  });
});
