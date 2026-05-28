// F.2.c: targeted tests for the raster-image branches added to
// scene-mutations. The broader mutation flows are covered through
// store.test.ts and duplicate.test.ts.

import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage, type Scene } from '../../core/scene';
import { ensureRasterImageLayer, pruneOrphanLayers } from './scene-mutations';

function blankScene(): Scene {
  return { objects: [], layers: [] };
}

function rasterImage(color: string): RasterImage {
  return {
    kind: 'raster-image',
    id: 'r1',
    source: 'test.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

describe('ensureRasterImageLayer', () => {
  it('creates an image-mode layer when the color is new', () => {
    const out = ensureRasterImageLayer(blankScene(), '#808080');
    expect(out.layers).toHaveLength(1);
    expect(out.layers[0]?.color).toBe('#808080');
    expect(out.layers[0]?.mode).toBe('image');
  });

  it('leaves existing layers untouched when the color is already present', () => {
    const seeded: Scene = {
      objects: [],
      layers: [
        {
          id: '#808080',
          color: '#808080',
          mode: 'line',
          power: 50,
          speed: 1200,
          passes: 1,
          visible: true,
          output: true,
          hatchAngleDeg: 0,
          hatchSpacingMm: 0.2,
        },
      ],
    };
    const out = ensureRasterImageLayer(seeded, '#808080');
    // Same object reference — no-op
    expect(out).toBe(seeded);
    expect(out.layers[0]?.mode).toBe('line'); // not flipped to 'image'
  });
});

describe('pruneOrphanLayers — raster image branch', () => {
  it('keeps the layer that a raster image references', () => {
    const seeded: Scene = {
      objects: [rasterImage('#808080')],
      layers: [
        {
          id: '#808080',
          color: '#808080',
          mode: 'image',
          power: 60,
          speed: 1500,
          passes: 1,
          visible: true,
          output: true,
          hatchAngleDeg: 0,
          hatchSpacingMm: 0.2,
        },
        {
          id: '#ff0000',
          color: '#ff0000',
          mode: 'line',
          power: 50,
          speed: 1500,
          passes: 1,
          visible: true,
          output: true,
          hatchAngleDeg: 0,
          hatchSpacingMm: 0.2,
        },
      ],
    };
    const pruned = pruneOrphanLayers(seeded);
    // Image layer kept (referenced by the raster); red layer dropped
    // (no remaining consumer).
    expect(pruned.layers.map((l) => l.color)).toEqual(['#808080']);
  });
});
