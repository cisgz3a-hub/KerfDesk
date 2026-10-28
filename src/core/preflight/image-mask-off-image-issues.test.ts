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
import { imageMaskOffImageIssues, maskShareOnImage } from './image-mask-off-image-issues';
import { closedMaskContours } from '../raster/image-mask';

// ADR-633 Amendment 2 (rolling audit v4 H5-P1-1) and Amendment 3 (rolling
// audit v5 J9-P1-1: a mask the image reaches only in part).

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

function square(id: string, x: number, y = 0): SceneObject {
  return createRectangle({
    id,
    color: '#000000',
    spec: { widthMm: 8, heightMm: 8, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
  });
}

const loop = (minX: number, minY: number, maxX: number, maxY: number) => ({
  closed: true,
  points: [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ],
});

// A frame from -10 to 20 with a hole from -5 to 15: its box covers a 10 mm
// photo at the origin, and its shape misses it.
function ring(id: string): SceneObject {
  const base = createRectangle({
    id,
    color: '#000000',
    spec: { widthMm: 30, heightMm: 30, cornerRadiusMm: 0 },
  });
  return {
    ...base,
    bounds: { minX: -10, minY: -10, maxX: 20, maxY: 20 },
    paths: [{ color: '#000000', polylines: [loop(-10, -10, 20, 20), loop(-5, -5, 15, 15)] }],
  } as SceneObject;
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

  it('names an image that reaches only part of its mask, with how much', () => {
    // The mask runs 6..14 over a photo 0..10: half of it lies on the photo.
    const issues = imageMaskOffImageIssues(project([photo('a', 0, 'm'), square('m', 6)]));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('Only 50% of the mask over "a.png" lies on the image');
    expect(issues[0]?.message).toContain('Remove Image Mask');
  });

  it('names each tile of an array left on one mask, a quarter each', () => {
    // Four 10 mm photos around (10, 10), all masked by one 8 mm square there.
    const tiles = [
      { ...photo('a', 0, 'm'), transform: { ...IDENTITY_TRANSFORM, x: 0, y: 0 } },
      { ...photo('b', 0, 'm'), transform: { ...IDENTITY_TRANSFORM, x: 10, y: 0 } },
      { ...photo('c', 0, 'm'), transform: { ...IDENTITY_TRANSFORM, x: 0, y: 10 } },
      { ...photo('d', 0, 'm'), transform: { ...IDENTITY_TRANSFORM, x: 10, y: 10 } },
    ];
    const issues = imageMaskOffImageIssues(project([...tiles, square('m', 6, 6)]));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain(
      '4 images lie on only part of their masks ("a.png" 25%, "b.png" 25%, "c.png" 25%, "d.png" 25%)',
    );
  });

  it('allows a sliver of overhang, and says both things in one warning', () => {
    // 0.3 of 8 mm (under 5%) hangs off the photo's right edge.
    expect(imageMaskOffImageIssues(project([photo('a', 0, 'm'), square('m', 2.3)]))).toEqual([]);
    const issues = imageMaskOffImageIssues(
      project([photo('a', 0, 'm'), photo('b', 0, 'n'), square('m', 50), square('n', 6)]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('The image "a.png" is masked by a shape that does not');
    expect(issues[0]?.message).toContain('Only 50% of the mask over "b.png"');
  });

  it('measures the mask shape, not its box: a ring around the photo misses it', () => {
    const issues = imageMaskOffImageIssues(project([photo('a', 0, 'm'), ring('m')]));
    expect(issues[0]?.message).toContain('nothing of it will be engraved');
  });

  it('measures a turned photo by its own rectangle, not its box', () => {
    // A 10 mm photo turned 45° about its corner is a diamond centred on
    // (0, 7.07). A mask filling the diamond's box has half its area on it.
    const turned = { ...photo('a', 0, 'm'), transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 } };
    const half = Math.SQRT2 * 5;
    const rect = (size: number, x: number, y: number) =>
      closedMaskContours(
        createRectangle({
          id: 'm',
          color: '#000000',
          spec: { widthMm: size, heightMm: size, cornerRadiusMm: 0 },
          transform: { ...IDENTITY_TRANSFORM, x, y },
        }),
      );
    expect(maskShareOnImage(rect(2 * half, -half, 0), turned)).toBeCloseTo(0.5, 2);
    expect(maskShareOnImage(rect(4, -2, half - 2), turned)).toBe(1);
  });

  it('skips images that do not output and masks that are gone', () => {
    expect(imageMaskOffImageIssues(project([photo('a', 0, 'm'), square('m', 50)], false))).toEqual(
      [],
    );
    expect(imageMaskOffImageIssues(project([photo('a', 0, 'gone')]))).toEqual([]);
  });
});
