import { describe, expect, it } from 'vitest';
import { clipRectangle } from '../../__fixtures__/owned-image-clip';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileRasterGroupsForLayer } from '../../core/job/compile-job-raster';
import type { VectorRaster } from '../../core/raster';
import { closedImageClipContours, closedMaskContours } from '../../core/raster/image-mask';
import {
  applyTransform,
  createLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type RasterImage,
  type SceneObject,
  type Transform,
} from '../../core/scene';
import { createEllipse, createRectangle } from '../../core/shapes/primitives';
import { cropMaskedRasterImage } from './crop-image';
import { lumaToBase64, type BitmapFields } from './luma-bitmap';

// Rolling audit v4 H5-P2-1 (ADR-480 Amendment 1): Crop Image and Flatten Image
// Mask baked the masked-out corners as white before Negative ran, so a
// light-mark photo burned them at full power after the crop.

const PLACED: Transform = { ...IDENTITY_TRANSFORM, x: 30, y: 40 };

function photo(overrides: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'photo',
    source: 'portrait.png',
    dataUrl: 'data:image/png;base64,portrait',
    pixelWidth: 40,
    pixelHeight: 40,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: PLACED,
    color: '#808080',
    operationIds: ['photo-op'],
    dither: 'threshold',
    linesPerMm: 2,
    lumaBase64: lumaToBase64(new Uint8Array(40 * 40).fill(200)),
    imageMaskId: 'mask',
    ...overrides,
  };
}

// The audit's oval: 20 x 16 mm over the photo's middle.
function oval(transform: Transform = { ...IDENTITY_TRANSFORM, x: 30, y: 42 }): SceneObject {
  return createEllipse({
    id: 'mask',
    color: '#000000',
    spec: { widthMm: 20, heightMm: 16 },
    transform,
  });
}

function operation(settings: Partial<Layer>): Layer {
  return {
    ...createLayer({ id: 'photo-op', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'threshold',
    linesPerMm: 2,
    power: 50,
    ...settings,
  };
}

function encode(raster: VectorRaster): BitmapFields {
  return { dataUrl: 'data:image/png;base64,baked', lumaBase64: lumaToBase64(raster.luma) };
}

function burn(
  image: RasterImage,
  mask: SceneObject | null,
  layer: Layer,
): { readonly cells: number; readonly totalS: number } {
  const sceneObjects = mask === null ? [image] : [image, mask];
  const { groups } = compileRasterGroupsForLayer([image], layer, DEFAULT_DEVICE_PROFILE, {
    sceneObjects,
  });
  let cells = 0;
  let totalS = 0;
  for (const group of groups)
    for (const s of group.sValues)
      if (s > 0) {
        cells += 1;
        totalS += s;
      }
  return { cells, totalS };
}

describe('Crop Image and Flatten keep the mask shape (ADR-480 Amendment 1)', () => {
  it.each<[string, Partial<Layer>, Partial<RasterImage>]>([
    ['Negative, Threshold', { negativeImage: true }, {}],
    ['Negative, Grayscale', { negativeImage: true, ditherAlgorithm: 'grayscale' }, {}],
    ['brightness -50, Grayscale', { ditherAlgorithm: 'grayscale' }, { brightness: -50 }],
    ['plain Threshold', {}, { lumaBase64: lumaToBase64(new Uint8Array(1600).fill(40)) }],
  ])('%s burns the same cells after the bake as through the live mask', async (_, op, image) => {
    const source = photo(image);
    const mask = oval();
    const layer = operation(op);
    const live = burn(source, mask, layer);

    const baked = await cropMaskedRasterImage(source, mask, encode);

    expect(baked.imageMaskId).toBeUndefined();
    expect(live.cells).toBeGreaterThan(0);
    expect(burn(baked, null, layer)).toEqual(live);
  });

  it('keeps the shape where the mask was when the photo is turned, stretched and mirrored', async () => {
    const transform: Transform = {
      x: 30,
      y: 40,
      rotationDeg: 30,
      scaleX: 1.5,
      scaleY: 0.8,
      mirrorX: true,
      mirrorY: false,
    };
    const centre = applyTransform({ x: 10, y: 10 }, transform);
    const mask = oval({ ...IDENTITY_TRANSFORM, x: centre.x - 10, y: centre.y - 8 });

    const baked = await cropMaskedRasterImage(photo({ transform }), mask, encode);

    const [clip] = closedImageClipContours(baked.imageClip ?? []);
    const [shape] = closedMaskContours(mask);
    expect(clip?.length).toBe(shape?.length);
    for (const [index, point] of (clip ?? []).entries()) {
      const placed = applyTransform(point, transform);
      expect(placed.x).toBeCloseTo(shape?.[index]?.x ?? NaN, 9);
      expect(placed.y).toBeCloseTo(shape?.[index]?.y ?? NaN, 9);
    }
  });

  it('keeps only the part of the mask inside a clip the photo already owns', async () => {
    // Local x 0-10 is the photo's own clip; the mask covers local x 2-18.
    const source = photo({ imageClip: [clipRectangle(0, 0, 10, 20)] });
    const mask = createRectangle({
      id: 'mask',
      color: '#000000',
      spec: { widthMm: 16, heightMm: 12, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 32, y: 44 },
    });
    const layer = operation({ negativeImage: true });
    const live = burn(source, mask, layer);

    const baked = await cropMaskedRasterImage(source, mask, encode);

    // 8 x 12 mm at 2 lines per mm.
    expect(live.cells).toBe(16 * 24);
    expect(burn(baked, null, layer)).toEqual(live);
  });
});
