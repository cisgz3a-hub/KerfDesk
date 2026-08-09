// Converts a relief Heightmap to the cached grayscale/alpha bitmap consumed by
// the proportional partial-grid canvas blitter.

import type { Heightmap } from '../../core/relief';

const TOP_GRAY = 232;
const FLOOR_GRAY = 64;

export function heightmapToCanvas(map: Heightmap, reliefDepthMm: number): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = map.widthCells;
  canvas.height = map.heightCells;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const image = ctx.createImageData(map.widthCells, map.heightCells);
  const px = image.data;
  const depthRange = Math.max(1e-9, reliefDepthMm);
  for (let i = 0; i < map.depth.length; i += 1) {
    const t = Math.min(1, Math.max(0, -(map.depth[i] ?? 0) / depthRange));
    const gray = Math.round(TOP_GRAY + (FLOOR_GRAY - TOP_GRAY) * t);
    const offset = i * 4;
    px[offset] = gray;
    px[offset + 1] = gray;
    px[offset + 2] = gray;
    px[offset + 3] = map.inclusion?.[i] === 0 ? 0 : 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
