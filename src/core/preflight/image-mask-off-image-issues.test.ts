import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../scene';
import { createRectangle } from '../shapes/primitives';
import { imageMaskOffImageIssues } from './image-mask-off-image-issues';

// ADR-633 Amendment 2 (rolling audit v4 H5-P1-1).

function photo(id: string, x: number, maskId: string | undefined): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,photo',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x },
    color: '#808080',
    operationIds: ['photo-op'],
    dither: 'threshold',
    linesPerMm: 1,
    ...(maskId === undefined ? {} : { imageMaskId: maskId }),
  };
}

function square(id: string, x: number): SceneObject {
  return createRectangle({
    id,
    color: '#000000',
    spec: { widthMm: 8, heightMm: 8, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x },
  });
}

function project(objects: ReadonlyArray<SceneObject>, output = true): Project {
  return {
    ...createProject(),
    scene: {
      objects,
      layers: [{ ...createLayer({ id: 'photo-op', color: '#808080', mode: 'image' }), output }],
    },
  };
}

describe('imageMaskOffImageIssues', () => {
  it('says nothing for a mask over its image, or an image without a mask', () => {
    expect(imageMaskOffImageIssues(project([photo('a', 0, 'm'), square('m', 1)]))).toEqual([]);
    expect(imageMaskOffImageIssues(project([photo('a', 0, undefined)]))).toEqual([]);
  });

  it('names every output image whose mask lies wholly off it, in one warning', () => {
    const issues = imageMaskOffImageIssues(
      project([photo('a', 0, 'm'), photo('b', 100, 'm'), photo('c', 200, 'm'), square('m', 1)]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('image-mask-off-image');
    expect(issues[0]?.message).toContain('2 images ("b.png", "c.png")');
  });

  it('treats a mask that only touches the image edge as missing it', () => {
    const issues = imageMaskOffImageIssues(project([photo('a', 0, 'm'), square('m', 10)]));
    expect(issues).toHaveLength(1);
  });

  it('skips images that do not output and masks that are gone', () => {
    expect(imageMaskOffImageIssues(project([photo('a', 0, 'm'), square('m', 50)], false))).toEqual(
      [],
    );
    expect(imageMaskOffImageIssues(project([photo('a', 0, 'gone')]))).toEqual([]);
  });
});
