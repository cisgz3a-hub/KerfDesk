import type { Bounds } from '../scene';
import type { VectorRaster } from './rasterize-vector';

/** Closed photo contours, in scene millimetres. Offsets index coordinate pairs. */
export type PackedPhotoPolylines = {
  readonly points: Float64Array;
  readonly offsets: Uint32Array;
};

type EdgeIndex = {
  readonly coordinates: Float64Array;
  readonly order: Uint32Array;
  readonly active: Uint32Array;
  readonly crossings: Float64Array;
  activeLength: number;
  next: number;
};

type PhotoRasterInput = {
  readonly geometry: PackedPhotoPolylines;
  readonly bounds: Bounds;
  readonly width: number;
  readonly height: number;
  readonly ink: number;
  readonly coverageAxis: 'x' | 'y';
};

const COVERAGE_SUBROWS = 4;
const SCANLINE_EPS = 1e-9;

/** Same even-odd, exact-width/four-subrow coverage as ordinary photo bitmap
 * assembly, without expanding transferred coordinates into Vec2/edge objects. */
export function rasterizePhotoCoverage(input: PhotoRasterInput): VectorRaster {
  validatePackedPhotoPolylines(input.geometry);
  const transpose = input.coverageAxis === 'y';
  const width = transpose ? input.height : input.width;
  const height = transpose ? input.width : input.height;
  const luma = new Uint8Array(input.width * input.height).fill(255);
  const coverage = new Float64Array(width);
  const edges = createEdgeIndex(input, transpose);
  for (let y = 0; y < height; y += 1) {
    coverage.fill(0);
    for (let sample = 0; sample < COVERAGE_SUBROWS; sample += 1) {
      const crossings = crossingsAt(edges, y + (sample + 0.5) / COVERAGE_SUBROWS);
      accumulateCoverage(coverage, crossings);
    }
    for (let x = 0; x < width; x += 1) {
      const area = Math.max(0, Math.min(1, coverage[x] ?? 0));
      const index = transpose ? x * input.width + y : y * input.width + x;
      luma[index] = Math.round(255 - (255 - input.ink) * area);
    }
  }
  return { luma, width: input.width, height: input.height };
}

export function validatePackedPhotoPolylines(geometry: PackedPhotoPolylines): void {
  const count = geometry.points.length / 2;
  if (!Number.isInteger(count) || geometry.offsets.length < 2 || geometry.offsets[0] !== 0) {
    throw new Error('Invalid packed photo contours.');
  }
  let previous = 0;
  for (const end of geometry.offsets.subarray(1)) {
    if (end > count || end - previous < 3) throw new Error('Invalid packed photo contour extent.');
    previous = end;
  }
  if (previous !== count) throw new Error('Incomplete packed photo contours.');
}

function createEdgeIndex(input: PhotoRasterInput, transpose: boolean): EdgeIndex {
  const coordinates = new Float64Array(input.geometry.points.length * 2);
  let count = 0;
  for (let contour = 1; contour < input.geometry.offsets.length; contour += 1) {
    const start = input.geometry.offsets[contour - 1] ?? 0;
    const end = input.geometry.offsets[contour] ?? 0;
    for (let point = start; point < end; point += 1) {
      const next = point + 1 === end ? start : point + 1;
      if (writePixelEdge(coordinates, count * 4, point, next, input, transpose)) count += 1;
    }
  }
  const order = Uint32Array.from({ length: count }, (_, index) => index);
  order.sort((a, b) => edgeMinY(coordinates, a) - edgeMinY(coordinates, b));
  return {
    coordinates,
    order,
    active: new Uint32Array(count),
    crossings: new Float64Array(count),
    activeLength: 0,
    next: 0,
  };
}

function writePixelEdge(
  coordinates: Float64Array,
  offset: number,
  a: number,
  b: number,
  input: PhotoRasterInput,
  transpose: boolean,
): boolean {
  const scaleX = input.width / (input.bounds.maxX - input.bounds.minX);
  const scaleY = input.height / (input.bounds.maxY - input.bounds.minY);
  const points = input.geometry.points;
  const ax = ((points[a * 2] ?? NaN) - input.bounds.minX) * scaleX;
  const ay = ((points[a * 2 + 1] ?? NaN) - input.bounds.minY) * scaleY;
  const bx = ((points[b * 2] ?? NaN) - input.bounds.minX) * scaleX;
  const by = ((points[b * 2 + 1] ?? NaN) - input.bounds.minY) * scaleY;
  if (!finitePair(ax, ay) || !finitePair(bx, by))
    throw new Error('Invalid photo contour coordinate.');
  coordinates[offset] = transpose ? ay : ax;
  coordinates[offset + 1] = transpose ? ax : ay;
  coordinates[offset + 2] = transpose ? by : bx;
  coordinates[offset + 3] = transpose ? bx : by;
  return Math.abs(transpose ? bx - ax : by - ay) >= SCANLINE_EPS;
}

function finitePair(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function edgeMinY(coordinates: Float64Array, index: number): number {
  return Math.min(coordinates[index * 4 + 1] ?? 0, coordinates[index * 4 + 3] ?? 0);
}

function edgeMaxY(coordinates: Float64Array, index: number): number {
  return Math.max(coordinates[index * 4 + 1] ?? 0, coordinates[index * 4 + 3] ?? 0);
}

function crossingsAt(edges: EdgeIndex, y: number): Float64Array {
  for (; edges.next < edges.order.length; edges.next += 1) {
    const edge = edges.order[edges.next] ?? 0;
    if (edgeMinY(edges.coordinates, edge) > y) break;
    if (edgeMaxY(edges.coordinates, edge) > y) edges.active[edges.activeLength++] = edge;
  }
  let kept = 0;
  let crossings = 0;
  for (let index = 0; index < edges.activeLength; index += 1) {
    const edge = edges.active[index] ?? 0;
    if (edgeMaxY(edges.coordinates, edge) <= y) continue;
    edges.active[kept++] = edge;
    const x = edgeCrossingX(edges.coordinates, edge, y);
    if (Number.isFinite(x)) edges.crossings[crossings++] = x;
  }
  edges.activeLength = kept;
  return edges.crossings.subarray(0, crossings).sort();
}

function edgeCrossingX(coordinates: Float64Array, edge: number, y: number): number {
  const offset = edge * 4;
  const ax = coordinates[offset] ?? 0;
  const ay = coordinates[offset + 1] ?? 0;
  const bx = coordinates[offset + 2] ?? 0;
  const by = coordinates[offset + 3] ?? 0;
  return ax + ((y - ay) / (by - ay)) * (bx - ax);
}

function accumulateCoverage(coverage: Float64Array, crossings: Float64Array): void {
  let inside = false;
  let start = 0;
  for (let index = 0; index < crossings.length; ) {
    const x = crossings[index] ?? 0;
    let end = index + 1;
    while (crossings[end] === x) end += 1;
    if ((end - index) % 2 !== 0) {
      if (inside) accumulateSpan(coverage, start, x);
      else start = x;
      inside = !inside;
    }
    index = end;
  }
}

function accumulateSpan(coverage: Float64Array, left: number, right: number): void {
  const start = Math.max(0, left);
  const end = Math.min(coverage.length, right);
  for (let x = Math.floor(start); x < Math.ceil(end); x += 1) {
    const width = Math.min(x + 1, end) - Math.max(x, start);
    coverage[x] = (coverage[x] ?? 0) + width / COVERAGE_SUBROWS;
  }
}
