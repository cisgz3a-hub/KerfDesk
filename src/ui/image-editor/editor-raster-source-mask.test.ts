import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { editorRasterOutputMask, editorRasterSourceMask } from './editor-raster-source-mask';
import { createSession } from './editor-session';

const BOUNDS = { minX: 0, minY: 0, maxX: 2, maxY: 1 };

function image(isMirroredX: boolean): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'image.png',
    dataUrl: 'data:image/png;base64,image',
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: BOUNDS,
    transform: { ...IDENTITY_TRANSFORM, mirrorX: isMirroredX },
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
  };
}

describe('editorRasterSourceMask', () => {
  it('inverts machine orientation before selecting the source pixel', () => {
    const session = createSession('R1', 'image.png', createRgbaBuffer(2, 1), BOUNDS);
    const mask = editorRasterSourceMask({
      session,
      object: image(true),
      device: DEFAULT_DEVICE_PROFILE,
      removed: { width: 2, height: 1, alpha: Uint8Array.of(0, 255) },
      activeIndex: 0,
    });
    expect(mask).toEqual(new Uint8Array([255, 0]));
  });

  it('does not target a transparent active-layer source pixel', () => {
    const session = createSession('R1', 'image.png', createRgbaBuffer(2, 1), BOUNDS);
    session.layers[0]?.buffer.data.set([0, 0, 0, 0], 0);
    const mask = editorRasterSourceMask({
      session,
      object: image(false),
      device: { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' },
      removed: { width: 2, height: 1, alpha: Uint8Array.of(255, 0) },
      activeIndex: 0,
    });
    expect(mask).toEqual(new Uint8Array([0, 0]));
  });

  it('does not authorize output pixels for an invalid active-layer index', () => {
    const session = createSession('R1', 'image.png', createRgbaBuffer(2, 1), BOUNDS);
    expect(
      editorRasterSourceMask({
        session,
        object: image(false),
        device: { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' },
        removed: { width: 2, height: 1, alpha: Uint8Array.of(255, 0) },
        activeIndex: -1,
      }),
    ).toEqual(new Uint8Array([0, 0]));
  });

  it('round-trips a mirrored source mask back to output orientation', () => {
    const source = { width: 2, height: 1, alpha: Uint8Array.of(255, 0) };
    expect(editorRasterOutputMask(source, image(true), DEFAULT_DEVICE_PROFILE).alpha).toEqual(
      Uint8Array.of(0, 255),
    );
  });
});
