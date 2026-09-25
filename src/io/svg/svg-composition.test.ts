import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type RasterImage,
} from '../../core/scene';
import { createImageMaskPixelTest } from '../../core/raster/image-mask';
import { exportSceneSvg } from './export-scene-svg';
import { parseSvg } from './parse-svg';
import { parseSvgInWorker } from './parse-svg-worker';
import type { SvgImageDescriptor } from './svg-import-fragment';

const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLSsAAAAASUVORK5CYII=';
const ring = (x: number, y: number, width: number, height: number) => ({
  closed: true,
  points: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ],
});
const image: RasterImage = {
  kind: 'raster-image',
  id: 'image',
  source: 'image.png',
  dataUrl: pixel,
  pixelWidth: 20,
  pixelHeight: 10,
  bounds: { minX: -2, minY: 4, maxX: 18, maxY: 14 },
  transform: {
    ...IDENTITY_TRANSFORM,
    x: -80,
    y: 35,
    scaleX: 2,
    scaleY: 3,
    rotationDeg: 90,
    mirrorX: true,
  },
  color: '#808080',
  dither: 'floyd-steinberg',
  linesPerMm: 10,
};
const mask: ImportedSvg = {
  kind: 'imported-svg',
  id: 'mask',
  source: 'mask.svg',
  bounds: { minX: 0, minY: 0, maxX: 35, maxY: 47 },
  transform: { ...IDENTITY_TRANSFORM, x: -125, y: -5 },
  paths: [{ color: '#000000', polylines: [ring(0, 0, 35, 47), ring(15, 15, 10, 10)] }],
};

function exported(
  objects: readonly (RasterImage | ImportedSvg)[],
  selected?: readonly string[],
): string {
  const base = createProject();
  const result = exportSceneSvg({ ...base, scene: { ...base.scene, objects } }, selected);
  if (result.kind === 'error') throw new Error(result.error);
  return result.value.svg;
}

function parsedImage(svgText: string): SvgImageDescriptor {
  const args = { svgText, id: 'round-trip', source: 'composition.svg' };
  const browser = parseSvg(args);
  expect(parseSvgInWorker(args)).toEqual(browser);
  const entry = browser.fragment?.entries.find((item) => item.kind === 'svg-image');
  if (entry?.kind !== 'svg-image') throw new Error('Image missing');
  return entry;
}

describe('SVG composition parsing', () => {
  it('retains image-only physical geometry, negative coordinates, rotation and unequal mirrored scale', () => {
    const entry = parsedImage(exported([image]));
    const corners = [
      { x: -2, y: 4 },
      { x: 18, y: 4 },
      { x: 18, y: 14 },
      { x: -2, y: 14 },
    ];
    const expected = [
      { x: -92, y: 39 },
      { x: -92, y: -1 },
      { x: -122, y: -1 },
      { x: -122, y: 39 },
    ];
    for (const [index, point] of corners.entries()) {
      const actual = applyTransform(point, entry.transform);
      expect(actual.x).toBeCloseTo(expected[index]?.x ?? NaN, 10);
      expect(actual.y).toBeCloseTo(expected[index]?.y ?? NaN, 10);
    }
    expect(entry.bounds).toEqual(image.bounds);
    expect(entry.dataUrl).toBe(pixel);
  });

  it('keeps image/vector paint order and independent fill semantics', () => {
    const svgText =
      '<svg viewBox="0 0 100 50"><path d="M0 0H10V10Z" fill="red"/><image x="10" y="20" width="30" height="20" preserveAspectRatio="none" href="' +
      pixel +
      '"/><path d="M20 0L30 10" stroke="blue" fill="none"/></svg>';
    const result = parseSvg({ svgText, id: 'order', source: 'order.svg' });
    expect(result.fragment?.entries.map((item) => item.kind)).toEqual([
      'imported-svg',
      'svg-image',
      'imported-svg',
    ]);
    expect(result.fragment?.entries[0]).toMatchObject({ operationOverride: { mode: 'fill' } });
    expect(result.fragment?.entries[2]).toMatchObject({ operationOverride: { mode: 'line' } });
    expect(result.ignoredImageElements).toBe(0);
  });

  it('resolves an independently placed compound mask into local image geometry without a helper object', () => {
    const entry = parsedImage(exported([mask, { ...image, imageMaskId: mask.id }], [image.id]));
    const raster: RasterImage = {
      ...image,
      bounds: entry.bounds,
      transform: entry.transform,
      ...(entry.imageClip === undefined ? {} : { imageClip: entry.imageClip }),
    };
    const contains = createImageMaskPixelTest(raster, null, 20, 10);
    expect(contains?.(0, 0)).toBe(true);
    expect(contains?.(10, 5)).toBe(false);
    expect(contains?.(19, 9)).toBe(true);
    const result = parseSvg({
      svgText: exported([mask, { ...image, imageMaskId: mask.id }], [image.id]),
      id: 'one',
      source: 'one.svg',
    });
    expect(result.fragment?.entries).toHaveLength(1);
    expect(result.object).toBeNull();
  });

  it('intersects nested owned and independently referenced clips on a second export', () => {
    const imageClip = [{ color: '#000000', polylines: [ring(-2, 4, 10, 10)] }];
    const entry = parsedImage(
      exported([mask, { ...image, imageClip, imageMaskId: mask.id }], [image.id]),
    );
    const raster: RasterImage = {
      ...image,
      transform: entry.transform,
      ...(entry.imageClip === undefined ? {} : { imageClip: entry.imageClip }),
    };
    const contains = createImageMaskPixelTest(raster, null, 20, 10);
    expect(contains?.(0, 0)).toBe(true);
    expect(contains?.(19, 0)).toBe(false);
    expect(contains?.(9, 5)).toBe(false);
  });

  it('applies root physical units and ancestor transforms to an image exactly once', () => {
    const entry = parsedImage(
      '<svg width="40mm" height="20mm" viewBox="-10 -5 400 200"><g transform="translate(10 20)"><image x="5" y="6" width="100" height="50" transform="scale(2 3)" preserveAspectRatio="none" href="' +
        pixel +
        '"/></g></svg>',
    );
    const point = applyTransform({ x: 5, y: 6 }, entry.transform);
    expect(point.x).toBeCloseTo(2);
    expect(point.y).toBeCloseTo(3.8);
    expect(entry.transform.scaleX).toBeCloseTo(0.2);
    expect(entry.transform.scaleY).toBeCloseTo(0.3);
  });

  it.each([
    ['transform="skewX(20)" preserveAspectRatio="none"', /skew/i],
    ['preserveAspectRatio="xMidYMid meet"', /aspect/i],
    ['preserveAspectRatio="none" opacity="0.5"', /opacity/i],
  ])(
    'rejects unrepresentable image presentation without approximating it: %s',
    (attributes, message) => {
      const svgText =
        '<svg viewBox="0 0 20 20"><image width="10" height="10" ' +
        attributes +
        ' href="' +
        pixel +
        '"/></svg>';
      expect(() => parseSvg({ svgText, id: 'bad', source: 'bad.svg' })).toThrow(message);
    },
  );
});
