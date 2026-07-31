import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, IDENTITY_TRANSFORM, type Layer, type RasterImage } from '../../core/scene';
import type { RasterKerfGroupFacts } from './editor-kerf-output-parity';
import { editorKerfThickenTarget } from './editor-kerf-thicken-target';
import { createSession } from './editor-session';
import { addLayerAboveActive } from './editor-session-layers';
import type { RasterOutputLoss } from './raster-output-run-loss';

const BOUNDS = { minX: 0, minY: 0, maxX: 2, maxY: 1 };

function image(overrides: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'image.png',
    dataUrl: 'data:image/png;base64,image',
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: BOUNDS,
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    ...overrides,
  };
}

function layer(overrides: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ id: 'L1', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'threshold',
    dotWidthCorrectionMm: 0.75,
    ...overrides,
  };
}

function group(overrides: Partial<RasterKerfGroupFacts> = {}): RasterKerfGroupFacts {
  return {
    layerId: 'L1',
    sValues: Uint16Array.of(1000, 0),
    blackS: 1000,
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: BOUNDS,
    dotWidthCorrectionMm: 0.75,
    ...overrides,
  };
}

function loss(alpha: ReadonlyArray<number>): RasterOutputLoss {
  return {
    mask: { width: 2, height: 1, alpha: Uint8Array.from(alpha) },
    pixels: alpha.filter((value) => value > 0).length,
  };
}

describe('editorKerfThickenTarget', () => {
  it('returns a final horizontal mask that already survives correction', () => {
    const session = createSession('R1', 'image.png', createRgbaBuffer(2, 1), BOUNDS);
    const target = editorKerfThickenTarget({
      session,
      object: image(),
      layer: layer(),
      group: group(),
      device: { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' },
      removed: loss([255, 0]),
    });
    expect(target?.mask.alpha).toEqual(new Uint8Array([255, 255]));
  });

  it.each([
    ['stateful dither', image(), layer({ ditherAlgorithm: 'floyd-steinberg' }), group()],
    ['ordered dither', image(), layer({ ditherAlgorithm: 'ordered' }), group()],
    ['rotation', image({ transform: { ...IDENTITY_TRANSFORM, rotationDeg: 1 } }), layer(), group()],
    ['mask', image({ imageMaskId: 'M1' }), layer(), group()],
    ['resampling', image(), layer(), group({ pixelWidth: 1 })],
    ['luma adjustment', image({ brightness: 1 }), layer(), group()],
  ] as const)('keeps %s warning-only', (_label, object, operation, raster) => {
    const session = createSession('R1', 'image.png', createRgbaBuffer(2, 1), BOUNDS);
    expect(
      editorKerfThickenTarget({
        session,
        object,
        layer: operation,
        group: raster,
        device: DEFAULT_DEVICE_PROFILE,
        removed: loss([255, 0]),
      }),
    ).toBeNull();
  });

  it('rejects a partial target when an upper layer owns one lost sample', () => {
    const base = createSession('R1', 'image.png', createRgbaBuffer(2, 1), BOUNDS);
    const session = addLayerAboveActive(base, 'upper');
    const upper = session.layers.find((candidate) => candidate.id === 'upper');
    if (upper === undefined) throw new Error('Expected an upper layer.');
    upper.buffer.data.set([0, 0, 0, 255], 4);
    expect(
      editorKerfThickenTarget({
        session: { ...session, activeLayerId: base.activeLayerId },
        object: image(),
        layer: layer(),
        group: group(),
        device: { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' },
        removed: loss([255, 255]),
      }),
    ).toBeNull();
  });

  it('rejects a target when the active layer does not own every lost sample', () => {
    const session = createSession('R1', 'image.png', createRgbaBuffer(2, 1), BOUNDS);
    const active = session.layers[0];
    if (active === undefined) throw new Error('Expected an active layer.');
    active.buffer.data.set([255, 255, 255, 0], 4);

    expect(
      editorKerfThickenTarget({
        session,
        object: image(),
        layer: layer(),
        group: group(),
        device: { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' },
        removed: loss([255, 255]),
      }),
    ).toBeNull();
  });

  it('keeps any visible upper-layer composition warning-only', () => {
    const base = createSession('R1', 'image.png', createRgbaBuffer(2, 1), BOUNDS);
    const session = addLayerAboveActive(base, 'upper');
    expect(
      editorKerfThickenTarget({
        session: { ...session, activeLayerId: base.activeLayerId },
        object: image(),
        layer: layer(),
        group: group(),
        device: { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' },
        removed: loss([255, 0]),
      }),
    ).toBeNull();
  });

  it('rejects a repair whose bounded row cannot survive at the document edge', () => {
    const onePixelBounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const session = createSession('R1', 'image.png', createRgbaBuffer(1, 1), onePixelBounds);
    expect(
      editorKerfThickenTarget({
        session,
        object: image({
          pixelWidth: 1,
          pixelHeight: 1,
          bounds: onePixelBounds,
        }),
        layer: layer(),
        group: group({
          pixelWidth: 1,
          pixelHeight: 1,
          bounds: onePixelBounds,
          sValues: Uint16Array.of(1000),
        }),
        device: { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' },
        removed: {
          mask: { width: 1, height: 1, alpha: Uint8Array.of(255) },
          pixels: 1,
        },
      }),
    ).toBeNull();
  });

  it('keeps an excessive repair radius warning-only', () => {
    const tinyBounds = { minX: 0, minY: 0, maxX: 0.002, maxY: 1 };
    const session = createSession('R1', 'image.png', createRgbaBuffer(2, 1), tinyBounds);
    expect(
      editorKerfThickenTarget({
        session,
        object: image({ bounds: tinyBounds }),
        layer: layer(),
        group: group({ bounds: tinyBounds }),
        device: { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' },
        removed: loss([255, 0]),
      }),
    ).toBeNull();
  });
});
