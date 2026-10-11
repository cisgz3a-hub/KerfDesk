import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SKETCH, type Sketch } from '../../core/design';
import { createProject, IDENTITY_TRANSFORM, type RasterImage, type Scene } from '../../core/scene';
import { createLayer } from '../../core/scene/layer';
import { createRectangle } from '../../core/shapes/primitives';
import { drawObjectDisplay } from '../workspace/object-display';
import { drawRasterImage } from '../workspace/draw-raster';
import { paintDesignProjectArtwork, pickDesignPhoto } from './design-project-photos';

vi.mock('../workspace/draw-raster', () => ({
  drawRasterImage: vi.fn(),
  burnedImageAdjustments: (photo: RasterImage) => photo,
}));

vi.mock('../workspace/object-display', () => ({
  isVectorSceneObject: (object: { kind: string }) => object.kind === 'shape',
  resolveObjectDisplay: () => ({
    paths: [],
    displaySegmentCount: 0,
    isSimplified: false,
    styleKey: 'test',
  }),
  drawObjectDisplay: vi.fn(),
}));

const photo: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,AA==',
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  pixelWidth: 40,
  pixelHeight: 20,
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 10,
};
const scene = (objects: RasterImage[] = [photo]): Scene => ({ ...createProject().scene, objects });
const view = { pxPerMm: 2, panXmm: 5, panYmm: 10 };
function context() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}
beforeEach(() => vi.clearAllMocks());

describe('project photos in the design composition', () => {
  it('uses the production raster renderer with the exact project object and matching pan/zoom', () => {
    const ready = vi.fn();
    const ctx = context();
    const transformed = {
      ...photo,
      transform: { ...IDENTITY_TRANSFORM, x: 45, y: 22, scaleX: 2, rotationDeg: 90, mirrorX: true },
    };
    paintDesignProjectArtwork(ctx, scene([transformed]), view, null, ready);
    expect(drawRasterImage).toHaveBeenCalledWith(
      ctx,
      transformed,
      { scale: 2, offsetX: -10, offsetY: -20 },
      { adjustments: transformed, onBitmapReady: ready },
    );
  });

  it('hides bound invisible photos but renders orphan and locked photos', () => {
    const hidden = createLayer({ id: 'hidden', color: '#123456', mode: 'image' });
    const hiddenPhoto = { ...photo, operationIds: ['hidden'] };
    const locked = { ...photo, id: 'locked', locked: true };
    paintDesignProjectArtwork(
      context(),
      { ...scene([hiddenPhoto, locked]), layers: [{ ...hidden, visible: false }] },
      view,
      null,
    );
    expect(drawRasterImage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(drawRasterImage).mock.calls[0]?.[1]).toBe(locked);
    expect(
      pickDesignPhoto(
        { ...scene([hiddenPhoto]), layers: [{ ...hidden, visible: false }] },
        EMPTY_SKETCH,
        { x: 5, y: 5 },
        1,
      ),
    ).toBeNull();
  });

  it('outlines the true rotated and mirrored corners rather than an untransformed bounding box', () => {
    const ctx = context();
    const transformed = {
      ...photo,
      transform: { ...IDENTITY_TRANSFORM, x: 50, y: 30, rotationDeg: 90, mirrorX: true },
    };
    paintDesignProjectArtwork(ctx, scene([transformed]), view, transformed.id);
    expect(ctx.moveTo).toHaveBeenCalledWith(90, 40);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(1, 90, 0);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(2, 70, 0);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(3, 70, 40);
  });

  it('picks only the transformed area and the last visible unlocked photo', () => {
    const turned = {
      ...photo,
      id: 'turned',
      transform: { ...IDENTITY_TRANSFORM, x: 50, y: 30, rotationDeg: 90 },
    };
    expect(pickDesignPhoto(scene([turned]), EMPTY_SKETCH, { x: 45, y: 40 }, 1)).toBe(turned);
    expect(pickDesignPhoto(scene([turned]), EMPTY_SKETCH, { x: 5, y: 5 }, 1)).toBeNull();
    const front = { ...photo, id: 'front' };
    expect(pickDesignPhoto(scene([photo, front]), EMPTY_SKETCH, { x: 5, y: 5 }, 1)).toBe(front);
    expect(
      pickDesignPhoto(scene([photo, { ...front, locked: true }]), EMPTY_SKETCH, { x: 5, y: 5 }, 1),
    ).toBe(photo);
  });

  it('keeps vector geometry above the photo selectable instead of opening the background photo', () => {
    const sketch: Sketch = {
      entities: [
        {
          kind: 'rect',
          id: 'shape',
          origin: { x: 2, y: 2 },
          widthMm: 5,
          heightMm: 5,
          cornerRadiusMm: 0,
        },
      ],
    };
    expect(pickDesignPhoto(scene(), sketch, { x: 4, y: 4 }, 1)).toBeNull();
    expect(pickDesignPhoto(scene(), sketch, { x: 15, y: 5 }, 1)).toBe(photo);
  });
});

it('keeps saved photo/vector stacking order while excluding the live draft objects', () => {
  const vector = createRectangle({
    id: 'vector',
    color: '#000000',
    spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
  });
  const order: string[] = [];
  vi.mocked(drawRasterImage).mockImplementation(() => {
    order.push('photo');
  });
  vi.mocked(drawObjectDisplay).mockImplementation(() => {
    order.push('vector');
  });
  const mixed = { ...scene(), objects: [vector, photo] };
  paintDesignProjectArtwork(context(), mixed, view, null);
  expect(order).toEqual(['vector', 'photo']);
  order.length = 0;
  paintDesignProjectArtwork(context(), { ...mixed, objects: [photo, vector] }, view, null);
  expect(order).toEqual(['photo', 'vector']);
  order.length = 0;
  paintDesignProjectArtwork(context(), mixed, view, null, undefined, new Set([vector.id]));
  expect(order).toEqual(['photo']);
});
