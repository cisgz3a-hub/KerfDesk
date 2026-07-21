import { describe, expect, it } from 'vitest';
import { createRgbaBuffer, RGBA_CHANNELS } from './rgba-buffer';
import {
  copyTilePixels,
  tileGridSize,
  tileRect,
  tilesForPixelRect,
  writeTilePixelsInPlace,
} from './tiles';

// A small tile size keeps multi-tile geometry testable without megapixel
// fixtures; production callers use the TILE_SIZE_PX default.
const TILE = 8;

describe('tileGridSize', () => {
  it('rounds partial edge tiles up', () => {
    expect(tileGridSize(17, 8, TILE)).toEqual({ cols: 3, rows: 1 });
    expect(tileGridSize(16, 16, TILE)).toEqual({ cols: 2, rows: 2 });
  });

  it('never reports an empty grid', () => {
    expect(tileGridSize(0, 0, TILE)).toEqual({ cols: 1, rows: 1 });
  });
});

describe('tileRect', () => {
  it('clamps edge tiles to the document rectangle', () => {
    const buffer = createRgbaBuffer(20, 10);
    expect(tileRect({ tileX: 2, tileY: 1 }, buffer, TILE)).toEqual({
      x: 16,
      y: 8,
      width: 4,
      height: 2,
    });
  });

  it('reports zero size for an off-grid coordinate', () => {
    const buffer = createRgbaBuffer(8, 8);
    const rect = tileRect({ tileX: 5, tileY: 0 }, buffer, TILE);
    expect(rect.width).toBe(0);
  });
});

describe('tilesForPixelRect', () => {
  const buffer = createRgbaBuffer(20, 20);

  it('returns the tiles under a rect spanning tile boundaries, row-major', () => {
    expect(tilesForPixelRect(buffer, { x: 6, y: 6, width: 4, height: 4 }, TILE)).toEqual([
      { tileX: 0, tileY: 0 },
      { tileX: 1, tileY: 0 },
      { tileX: 0, tileY: 1 },
      { tileX: 1, tileY: 1 },
    ]);
  });

  it('clamps rects that overhang the document', () => {
    expect(tilesForPixelRect(buffer, { x: 18, y: 18, width: 50, height: 50 }, TILE)).toEqual([
      { tileX: 2, tileY: 2 },
    ]);
    expect(tilesForPixelRect(buffer, { x: -3, y: -3, width: 5, height: 5 }, TILE)).toEqual([
      { tileX: 0, tileY: 0 },
    ]);
  });

  it('returns nothing for empty or fully outside rects', () => {
    expect(tilesForPixelRect(buffer, { x: 5, y: 5, width: 0, height: 4 }, TILE)).toEqual([]);
    expect(tilesForPixelRect(buffer, { x: 100, y: 0, width: 4, height: 4 }, TILE)).toEqual([]);
  });

  it('covers fractional dirty rects with the enclosing pixel grid', () => {
    expect(tilesForPixelRect(buffer, { x: 7.6, y: 0, width: 0.2, height: 1 }, TILE)).toEqual([
      { tileX: 0, tileY: 0 },
    ]);
  });
});

describe('copyTilePixels / writeTilePixelsInPlace', () => {
  it('round-trips a partial edge tile byte-exactly', () => {
    const buffer = createRgbaBuffer(10, 10);
    // Paint a recognizable gradient into the bottom-right partial tile.
    for (let i = 0; i < buffer.data.length; i += 1) buffer.data[i] = i % 251;
    const coord = { tileX: 1, tileY: 1 };

    const snapshot = copyTilePixels(buffer, coord, TILE);
    expect(snapshot.length).toBe(2 * 2 * RGBA_CHANNELS);

    // Trash the region, then restore it from the snapshot.
    buffer.data.fill(0);
    expect(writeTilePixelsInPlace(buffer, coord, snapshot, TILE)).toBe(true);
    expect(Array.from(copyTilePixels(buffer, coord, TILE))).toEqual(Array.from(snapshot));
    // Bytes outside the tile stay trashed — the write is tile-scoped.
    expect(buffer.data[0]).toBe(0);
  });

  it('refuses a snapshot whose length does not match the tile rect', () => {
    const buffer = createRgbaBuffer(10, 10);
    const stale = new Uint8ClampedArray(3);
    expect(writeTilePixelsInPlace(buffer, { tileX: 0, tileY: 0 }, stale, TILE)).toBe(false);
    expect(buffer.data.every((byte) => byte === 255)).toBe(true);
  });
});
