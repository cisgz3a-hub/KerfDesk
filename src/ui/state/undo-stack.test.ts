import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { limitProjectHistory } from './undo-stack';

function photoProject(): Project {
  const project = createProject();
  const photo: RasterImage = {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    dataUrl: 'png',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#000000',
    dither: 'threshold',
    linesPerMm: 1,
    editorDocument: {
      version: 1,
      width: 1,
      height: 1,
      activeLayerId: 'layer',
      layers: [
        {
          id: 'layer',
          name: 'layer',
          isVisible: true,
          opacity: 1,
          blend: 'normal',
          rgbaBase64: 'AAAAAA==',
        },
      ],
    },
  };
  return { ...project, scene: { ...project.scene, objects: [photo] } };
}

describe('retained project source history', () => {
  it('drops oldest distinct photo revisions at the byte budget', () => {
    const revisions = [photoProject(), photoProject(), photoProject()];
    expect(limitProjectHistory(revisions, 32)).toEqual(revisions.slice(1));
  });
  it('counts a source shared by many ordinary project edits only once', () => {
    const project = photoProject();
    const revisions = Array.from({ length: 50 }, (_, index) => ({ ...project, notes: `${index}` }));
    expect(limitProjectHistory(revisions, 16)).toEqual(revisions);
    expect(limitProjectHistory(revisions, 1)).toEqual(revisions);
  });
  it('keeps the immediate Undo even when one supported source exceeds the budget', () => {
    const revisions = [photoProject(), photoProject()];
    expect(limitProjectHistory(revisions, 1)).toEqual(revisions.slice(-1));
  });
});
