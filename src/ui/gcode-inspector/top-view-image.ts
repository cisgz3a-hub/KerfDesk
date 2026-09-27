// The program seen from above, as a flat image, for when the 3D view cannot
// show it (ADR-485): no WebGL, a lost graphics context, or a program too big
// for the GPU to draw in time. Each solid move is walked a pixel at a time and
// each pixel keeps the deepest move that crossed it, the later one on a tie.
// The pixels take their move's colour in the chosen lens, as the 3D view
// shows it, so the legend reads the same. Rapids are not drawn. Working out
// which move each pixel shows is the costly part and is kept, so a lens
// change only repaints.

import { SEG_KIND } from '../../core/gcode-view';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import { renderedLineByte } from '../viewer3d/segment-buckets';
import type { InspectorRenderModel } from './inspector-model';

/** Which move each pixel shows, row by row from the top. */
export type TopViewGrid = {
  readonly width: number;
  readonly height: number;
  /** The move's index plus one; 0 where no move crosses. */
  readonly moves: Uint32Array;
};

type TopViewModel = Pick<InspectorRenderModel, 'segmentCount' | 'positions' | 'segKind'>;
type Point = readonly [x: number, y: number, z: number];
type Fit = { readonly scale: number; readonly x: number; readonly y: number };
type Extent = { minX: number; maxX: number; minY: number; maxY: number };

const MARGIN_PX = 8;
const TINY_SPAN = 1e-4;
const FLOATS_PER_MOVE = 6;

export function topViewGrid(
  model: TopViewModel,
  size: { readonly width: number; readonly height: number },
): TopViewGrid | null {
  const width = Math.floor(size.width);
  const height = Math.floor(size.height);
  const extent = extentOf(model);
  if (width < 1 || height < 1 || extent === null) return null;
  const fit = fitOf(extent, width, height);
  const moves = new Uint32Array(width * height);
  const depths = new Float32Array(width * height).fill(Infinity);
  const grid = { width, height, moves };
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (model.segKind[index] === SEG_KIND.travel) continue;
    const at = index * FLOATS_PER_MOVE;
    const from = pixelOf(model.positions, at, fit, height);
    const to = pixelOf(model.positions, at + 3, fit, height);
    plot(grid, depths, index + 1, from, to);
  }
  return grid;
}

/** RGBA pixels for `ImageData`, each in its move's colour. */
export function paintTopView(
  grid: TopViewGrid,
  colorOf: (segmentIndex: number) => readonly [number, number, number],
  background: number,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(grid.moves.length * 4).fill(255);
  const back = [(background >> 16) & 0xff, (background >> 8) & 0xff, background & 0xff];
  const onScreen = screenColours();
  let lastMove = -1;
  let colour: ReadonlyArray<number> = back;
  for (let pixel = 0; pixel < grid.moves.length; pixel += 1) {
    const move = grid.moves[pixel] ?? 0;
    if (move !== lastMove) {
      lastMove = move;
      colour = move === 0 ? back : onScreen(colorOf(move - 1));
    }
    const at = pixel * 4;
    pixels[at] = colour[0] ?? 0;
    pixels[at + 1] = colour[1] ?? 0;
    pixels[at + 2] = colour[2] ?? 0;
  }
  return pixels;
}

// A lens gives neighbouring moves the same colour more often than not, so the
// last one's screen colour is kept. One array is reused: this runs per pixel.
function screenColours(): (rgb: readonly [number, number, number]) => ReadonlyArray<number> {
  const last = [NaN, NaN, NaN];
  const bytes = [0, 0, 0];
  return (rgb) => {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = rgb[channel] ?? 0;
      if (value === last[channel]) continue;
      last[channel] = value;
      bytes[channel] = renderedLineByte(value);
    }
    return bytes;
  };
}

function extentOf(model: TopViewModel): Extent | null {
  let extent: Extent | null = null;
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (model.segKind[index] === SEG_KIND.travel) continue;
    extent ??= { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const at of [index * FLOATS_PER_MOVE, index * FLOATS_PER_MOVE + 3]) {
      const x = model.positions[at] ?? 0;
      const y = model.positions[at + 1] ?? 0;
      extent.minX = Math.min(extent.minX, x);
      extent.maxX = Math.max(extent.maxX, x);
      extent.minY = Math.min(extent.minY, y);
      extent.maxY = Math.max(extent.maxY, y);
    }
  }
  return extent;
}

// The whole job in the middle of the image, the same scale both ways.
function fitOf(extent: Extent, width: number, height: number): Fit {
  const spanX = extent.maxX - extent.minX;
  const spanY = extent.maxY - extent.minY;
  const roomX = Math.max(1, width - 2 * MARGIN_PX);
  const roomY = Math.max(1, height - 2 * MARGIN_PX);
  const scale = Math.min(roomX / Math.max(spanX, TINY_SPAN), roomY / Math.max(spanY, TINY_SPAN));
  return {
    scale,
    x: (width - spanX * scale) / 2 - extent.minX * scale,
    y: (height - spanY * scale) / 2 - extent.minY * scale,
  };
}

// Image pixels run down from the top; Y runs up.
function pixelOf(positions: Float32Array, at: number, fit: Fit, height: number): Point {
  return [
    (positions[at] ?? 0) * fit.scale + fit.x,
    height - ((positions[at + 1] ?? 0) * fit.scale + fit.y),
    positions[at + 2] ?? 0,
  ];
}

// Walks the move one pixel at a time; a pixel takes it unless a deeper move
// already crossed there.
function plot(grid: TopViewGrid, depths: Float32Array, move: number, from: Point, to: Point): void {
  const { width, height, moves } = grid;
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]))),
  );
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const column = Math.floor(from[0] + (to[0] - from[0]) * t);
    const row = Math.floor(from[1] + (to[1] - from[1]) * t);
    if (column < 0 || column >= width || row < 0 || row >= height) continue;
    const pixel = row * width + column;
    const depth = from[2] + (to[2] - from[2]) * t;
    if (depth > (depths[pixel] ?? Infinity)) continue;
    depths[pixel] = depth;
    moves[pixel] = move;
  }
}
