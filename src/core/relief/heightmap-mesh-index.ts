// A uniform bin grid over a mesh relief's triangles (ADR-578). Each bin lists
// the triangles whose plan box overlaps it, highest first, so a contact query
// stops reading a bin as soon as its next triangle stands no higher than the
// best tip found so far: the tip is the cutter's lowest point, so a triangle
// can never lift it above the triangle's own highest corner.
//
// The index belongs to the triangle array and the bin size, and is built once
// for every cutter that reads the same map.

export const FLOATS_PER_MESH_TRIANGLE = 9;
// Bins per side are capped so a pathological mesh cannot allocate an
// unbounded grid; larger bins only make each query read more triangles.
const MAX_BINS = 1 << 20;

export type MeshIndex = {
  readonly triangles: Float64Array;
  readonly count: number;
  // Highest z of each triangle.
  readonly top: Float64Array;
  // minX, maxX, minY, maxY of each triangle.
  readonly box: Float64Array;
  readonly originX: number;
  readonly originY: number;
  readonly binMm: number;
  readonly binsX: number;
  readonly binsY: number;
  // Bin b lists binTriangles[binStart[b] .. binStart[b + 1]).
  readonly binStart: Int32Array;
  readonly binTriangles: Int32Array;
};

const cache = new WeakMap<Float64Array, Map<number, MeshIndex>>();

export function meshIndexFor(triangles: Float64Array, binMm: number): MeshIndex {
  let byBin = cache.get(triangles);
  if (byBin === undefined) {
    byBin = new Map();
    cache.set(triangles, byBin);
  }
  const cached = byBin.get(binMm);
  if (cached !== undefined) return cached;
  const built = buildIndex(triangles, binMm);
  byBin.set(binMm, built);
  return built;
}

function buildIndex(triangles: Float64Array, requestedBinMm: number): MeshIndex {
  const count = Math.floor(triangles.length / FLOATS_PER_MESH_TRIANGLE);
  const top = new Float64Array(count);
  const box = new Float64Array(count * 4);
  const extent = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (let t = 0; t < count; t += 1) measureTriangle(triangles, t, top, box, extent);
  const layout = binLayout(count === 0 ? null : extent, requestedBinMm);
  const { binStart, binTriangles } = fillBins(box, count, layout);
  const bins = layout.binsX * layout.binsY;
  for (let b = 0; b < bins; b += 1) {
    binTriangles
      .subarray(binStart[b] ?? 0, binStart[b + 1] ?? 0)
      .sort((p, q) => (top[q] ?? 0) - (top[p] ?? 0));
  }
  return { triangles, count, top, box, ...layout, binStart, binTriangles };
}

function binLayout(extent: Extent | null, requestedBinMm: number): BinLayout {
  const spanX = extent === null ? 0 : extent.maxX - extent.minX;
  const spanY = extent === null ? 0 : extent.maxY - extent.minY;
  let binMm = requestedBinMm > 0 && Number.isFinite(requestedBinMm) ? requestedBinMm : 1;
  while ((Math.floor(spanX / binMm) + 1) * (Math.floor(spanY / binMm) + 1) > MAX_BINS) binMm *= 2;
  return {
    originX: extent?.minX ?? 0,
    originY: extent?.minY ?? 0,
    binMm,
    binsX: Math.floor(spanX / binMm) + 1,
    binsY: Math.floor(spanY / binMm) + 1,
  };
}

// Counting sort of triangle ids into their bins.
function fillBins(
  box: Float64Array,
  count: number,
  layout: BinLayout,
): { readonly binStart: Int32Array; readonly binTriangles: Int32Array } {
  const bins = layout.binsX * layout.binsY;
  const binStart = new Int32Array(bins + 1);
  forEachTriangleBin(box, count, layout, (_t, bin) => {
    binStart[bin + 1] = (binStart[bin + 1] ?? 0) + 1;
  });
  for (let b = 0; b < bins; b += 1) binStart[b + 1] = (binStart[b + 1] ?? 0) + (binStart[b] ?? 0);
  const fill = binStart.slice(0, bins);
  const binTriangles = new Int32Array(binStart[bins] ?? 0);
  forEachTriangleBin(box, count, layout, (t, bin) => {
    const at = fill[bin] ?? 0;
    binTriangles[at] = t;
    fill[bin] = at + 1;
  });
  return { binStart, binTriangles };
}

type Extent = { minX: number; maxX: number; minY: number; maxY: number };

function measureTriangle(
  triangles: Float64Array,
  t: number,
  top: Float64Array,
  box: Float64Array,
  extent: Extent,
): void {
  const at = t * FLOATS_PER_MESH_TRIANGLE;
  const x0 = triangles[at] ?? 0;
  const y0 = triangles[at + 1] ?? 0;
  const x1 = triangles[at + 3] ?? 0;
  const y1 = triangles[at + 4] ?? 0;
  const x2 = triangles[at + 6] ?? 0;
  const y2 = triangles[at + 7] ?? 0;
  top[t] = Math.max(triangles[at + 2] ?? 0, triangles[at + 5] ?? 0, triangles[at + 8] ?? 0);
  const minX = Math.min(x0, x1, x2);
  const maxX = Math.max(x0, x1, x2);
  const minY = Math.min(y0, y1, y2);
  const maxY = Math.max(y0, y1, y2);
  box[t * 4] = minX;
  box[t * 4 + 1] = maxX;
  box[t * 4 + 2] = minY;
  box[t * 4 + 3] = maxY;
  extent.minX = Math.min(extent.minX, minX);
  extent.maxX = Math.max(extent.maxX, maxX);
  extent.minY = Math.min(extent.minY, minY);
  extent.maxY = Math.max(extent.maxY, maxY);
}

type BinLayout = Pick<MeshIndex, 'originX' | 'originY' | 'binMm' | 'binsX' | 'binsY'>;

function forEachTriangleBin(
  box: Float64Array,
  count: number,
  layout: BinLayout,
  visit: (triangle: number, bin: number) => void,
): void {
  for (let t = 0; t < count; t += 1) {
    const range = binRange(
      layout,
      box[t * 4] ?? 0,
      box[t * 4 + 1] ?? 0,
      box[t * 4 + 2] ?? 0,
      box[t * 4 + 3] ?? 0,
    );
    for (let by = range.minY; by <= range.maxY; by += 1) {
      for (let bx = range.minX; bx <= range.maxX; bx += 1) visit(t, by * layout.binsX + bx);
    }
  }
}

export type BinRange = { minX: number; maxX: number; minY: number; maxY: number };

/** Bins overlapping a plan rectangle, clamped to the grid (empty when outside). */
export function binRange(
  layout: BinLayout,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): BinRange {
  const clamp = (value: number, bins: number): number =>
    Math.min(bins - 1, Math.max(0, Math.floor(value)));
  const x0 = (minX - layout.originX) / layout.binMm;
  const x1 = (maxX - layout.originX) / layout.binMm;
  const y0 = (minY - layout.originY) / layout.binMm;
  const y1 = (maxY - layout.originY) / layout.binMm;
  if (x1 < 0 || y1 < 0 || x0 >= layout.binsX || y0 >= layout.binsY) {
    return { minX: 0, maxX: -1, minY: 0, maxY: -1 };
  }
  return {
    minX: clamp(x0, layout.binsX),
    maxX: clamp(x1, layout.binsX),
    minY: clamp(y0, layout.binsY),
    maxY: clamp(y1, layout.binsY),
  };
}

/** Plan distance from (x, y) to triangle t's box; 0 inside it. */
export function boxDistance(index: MeshIndex, t: number, x: number, y: number): number {
  const at = t * 4;
  const dx = Math.max((index.box[at] ?? 0) - x, 0, x - (index.box[at + 1] ?? 0));
  const dy = Math.max((index.box[at + 2] ?? 0) - y, 0, y - (index.box[at + 3] ?? 0));
  return Math.sqrt(dx * dx + dy * dy);
}
