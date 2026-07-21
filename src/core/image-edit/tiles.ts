// Tile math for the Image Studio document (ADR-242).
//
// The working buffer is addressed as a grid of fixed-size square tiles so an
// edit (and its undo snapshot) touches only the tiles under its dirty rect
// instead of the whole document — the standard paint-engine design that keeps
// deep history affordable. Edge tiles are clamped to the document rectangle.

import { RGBA_CHANNELS, type RgbaBuffer } from './rgba-buffer';

export const TILE_SIZE_PX = 256;

export type TileCoord = {
  readonly tileX: number;
  readonly tileY: number;
};

/** Pixel-space rectangle of one tile, clamped to the document. */
export type TileRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type PixelRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export function tileGridSize(
  bufferWidth: number,
  bufferHeight: number,
  tileSizePx: number = TILE_SIZE_PX,
): { readonly cols: number; readonly rows: number } {
  return {
    cols: Math.max(1, Math.ceil(bufferWidth / tileSizePx)),
    rows: Math.max(1, Math.ceil(bufferHeight / tileSizePx)),
  };
}

/** The clamped pixel rect of a tile; zero-sized when the coord is off-grid. */
export function tileRect(
  coord: TileCoord,
  buffer: RgbaBuffer,
  tileSizePx: number = TILE_SIZE_PX,
): TileRect {
  const x = coord.tileX * tileSizePx;
  const y = coord.tileY * tileSizePx;
  return {
    x,
    y,
    width: Math.max(0, Math.min(tileSizePx, buffer.width - x)),
    height: Math.max(0, Math.min(tileSizePx, buffer.height - y)),
  };
}

/**
 * Every tile touched by a pixel rect, row-major. The rect is clamped to the
 * document first; a rect fully outside (or empty) touches no tiles.
 */
export function tilesForPixelRect(
  buffer: RgbaBuffer,
  rect: PixelRect,
  tileSizePx: number = TILE_SIZE_PX,
): readonly TileCoord[] {
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(buffer.width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(buffer.height, Math.ceil(rect.y + rect.height));
  if (right <= left || bottom <= top) return [];
  const coords: TileCoord[] = [];
  const firstTileY = Math.floor(top / tileSizePx);
  const lastTileY = Math.floor((bottom - 1) / tileSizePx);
  const firstTileX = Math.floor(left / tileSizePx);
  const lastTileX = Math.floor((right - 1) / tileSizePx);
  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      coords.push({ tileX, tileY });
    }
  }
  return coords;
}

/** Snapshot one tile's pixels (length = rect.width * rect.height * 4). */
export function copyTilePixels(
  buffer: RgbaBuffer,
  coord: TileCoord,
  tileSizePx: number = TILE_SIZE_PX,
): Uint8ClampedArray {
  const rect = tileRect(coord, buffer, tileSizePx);
  const out = new Uint8ClampedArray(rect.width * rect.height * RGBA_CHANNELS);
  for (let row = 0; row < rect.height; row += 1) {
    const srcStart = ((rect.y + row) * buffer.width + rect.x) * RGBA_CHANNELS;
    const srcEnd = srcStart + rect.width * RGBA_CHANNELS;
    out.set(buffer.data.subarray(srcStart, srcEnd), row * rect.width * RGBA_CHANNELS);
  }
  return out;
}

/**
 * Write a tile snapshot back into the buffer. Returns false (writing nothing)
 * when the snapshot length does not match the tile's clamped rect — snapshots
 * are only valid against unchanged document dimensions.
 */
export function writeTilePixelsInPlace(
  buffer: RgbaBuffer,
  coord: TileCoord,
  pixels: Uint8ClampedArray,
  tileSizePx: number = TILE_SIZE_PX,
): boolean {
  const rect = tileRect(coord, buffer, tileSizePx);
  if (pixels.length !== rect.width * rect.height * RGBA_CHANNELS) return false;
  for (let row = 0; row < rect.height; row += 1) {
    const rowStart = row * rect.width * RGBA_CHANNELS;
    const rowEnd = rowStart + rect.width * RGBA_CHANNELS;
    const destStart = ((rect.y + row) * buffer.width + rect.x) * RGBA_CHANNELS;
    buffer.data.set(pixels.subarray(rowStart, rowEnd), destStart);
  }
  return true;
}
