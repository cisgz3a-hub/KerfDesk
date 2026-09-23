import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { compileJob } from '../job';
import { streamedRasterRowProvider } from '../job/compile-job-raster-stream';
import { rasterBoundsInMachineCoords } from '../job/raster-bounds';
import { createLayer, IDENTITY_TRANSFORM, type ColoredPath, type RasterImage } from '../scene';
import { createRectangle } from '../shapes/primitives';
import { applyImageMaskToLuma, createImageMaskPixelTest } from './image-mask';

function rectangle(minX: number, minY: number, maxX: number, maxY: number): ColoredPath {
  return {
    color: '#000000',
    polylines: [
      {
        closed: true,
        points: [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ],
      },
    ],
  };
}

function raster(overrides: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'owned-clip',
    source: 'clip.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 4,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: Buffer.from(new Uint8Array(8)).toString('base64'),
    ...overrides,
  };
}

describe('owned image clips', () => {
  it.each([
    IDENTITY_TRANSFORM,
    {
      ...IDENTITY_TRANSFORM,
      x: -27,
      y: 19,
      rotationDeg: 37,
      mirrorX: true,
      scaleX: 2,
      scaleY: 0.4,
    },
    { ...IDENTITY_TRANSFORM, x: 13, y: -52, rotationDeg: 90, mirrorY: true },
  ])('keeps local compound holes and nonzero bounds under image transform %j', (transform) => {
    const image = raster({
      bounds: { minX: 10, minY: 20, maxX: 14, maxY: 22 },
      transform,
      imageClip: [rectangle(10, 20, 13, 22), { ...rectangle(11, 20, 12, 21), color: '#ff0000' }],
    });
    const original = new Uint8Array(8);
    expect(
      Array.from(
        applyImageMaskToLuma({ image, maskObject: null, luma: original, width: 4, height: 2 }),
      ),
    ).toEqual([0, 255, 0, 255, 0, 0, 0, 255]);
    expect(Array.from(original)).toEqual(new Array(8).fill(0));
  });

  it('intersects the owned clip with an independently placed external mask', () => {
    const image = raster({
      imageClip: [rectangle(0, 0, 3, 2)],
      imageMaskId: 'mask',
      transform: { ...IDENTITY_TRANSFORM, x: 10, scaleX: 2 },
    });
    const mask = {
      ...createRectangle({
        id: 'mask',
        color: '#000000',
        spec: { widthMm: 4, heightMm: 2, cornerRadiusMm: 0 },
      }),
      transform: { ...IDENTITY_TRANSFORM, x: 12 },
    };
    expect(
      Array.from(
        applyImageMaskToLuma({
          image,
          maskObject: mask,
          luma: new Uint8Array(8),
          width: 4,
          height: 2,
        }),
      ),
    ).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
    const moved = { ...image, transform: { ...image.transform, x: 12 } };
    expect(
      Array.from(
        applyImageMaskToLuma({
          image: moved,
          maskObject: mask,
          luma: new Uint8Array(8),
          width: 4,
          height: 2,
        }),
      ),
    ).toEqual([0, 0, 255, 255, 0, 0, 255, 255]);
  });

  it('retains an owned clip when an external mask is missing, and distinguishes absent from empty', () => {
    const source = new Uint8Array(8);
    expect(createImageMaskPixelTest(raster(), null, 4, 2)).toBeNull();
    expect(
      Array.from(
        applyImageMaskToLuma({
          image: raster({ imageClip: [], imageMaskId: 'missing' }),
          maskObject: null,
          luma: source,
          width: 4,
          height: 2,
        }),
      ),
    ).toEqual(new Array(8).fill(255));
    const test = createImageMaskPixelTest(
      raster({ imageClip: [rectangle(1, 0, 3, 2)], imageMaskId: 'missing' }),
      null,
      4,
      2,
    );
    expect(test?.(0, 0)).toBe(false);
    expect(test?.(1, 0)).toBe(true);
  });

  it('keeps endpoint-closed contours while excluding an open contour', () => {
    const path = rectangle(1, 0, 3, 2),
      line = path.polylines[0]!;
    const image = raster({
      imageClip: [
        {
          ...path,
          polylines: [
            { ...line, closed: false, points: [...line.points, line.points[0]!] },
            { ...line, closed: false },
          ],
        },
      ],
    });
    expect(
      Array.from(
        applyImageMaskToLuma({
          image,
          maskObject: null,
          luma: new Uint8Array(8),
          width: 4,
          height: 2,
        }),
      ),
    ).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
  });

  it('applies the same clip in compiled and streamed raster power without an extra object', () => {
    const image = raster({ imageClip: [rectangle(1, 0, 3, 2)] });
    const device = { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' as const };
    const layer = {
      ...createLayer({ id: 'image', color: image.color, mode: 'image' }),
      passThrough: true,
    };
    const job = compileJob({ objects: [image], layers: [layer] }, device);
    expect(job.groups).toHaveLength(1);
    const group = job.groups[0];
    if (group?.kind !== 'raster') throw Error('Expected raster output.');
    expect(Array.from(group.sValues)).toEqual([0, 300, 300, 0, 0, 300, 300, 0]);
    const row = streamedRasterRowProvider({
      sourceLuma: new Uint8Array(8),
      sourceWidth: 4,
      sourceHeight: 2,
      pixelWidth: 4,
      pixelHeight: 2,
      obj: image,
      maskObject: null,
      device,
      bounds: rasterBoundsInMachineCoords(image, device),
      algorithm: 'threshold',
      sMax: 300,
      sMin: 0,
    });
    expect([...row(0), ...row(1)]).toEqual(Array.from(group.sValues));
  });
});
