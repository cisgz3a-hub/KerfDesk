import type { RawImageData } from '../../core/trace';
import type { ColoredPath, Vec2 } from '../../core/scene';

export type EdgeSquareFixture = {
  readonly name: string;
  readonly image: RawImageData;
  readonly size: number;
  readonly lo: number;
  readonly hi: number;
};

export type SquareEdgeTruthMetrics = {
  readonly edgePixelCount: number;
  readonly maxInteriorVerticalEdgeClustersPerRow: number;
  readonly maxInteriorHorizontalEdgeClustersPerColumn: number;
};

export type SquareEdgeQualityMetrics = {
  readonly edgePixelCount: number;
  readonly coverageRatio: number;
  readonly maxParallelResponsesPerExpectedEdge: number;
  readonly strayEdgePixelCount: number;
};

export type SquarePathEdgeQualityMetrics = {
  readonly pointCount: number;
  readonly totalPolylineLength: number;
  readonly coverageRatio: number;
  readonly strayPointCount: number;
};

const EDGE_BAND_RADIUS_PX = 2;
const PATH_EDGE_BAND_RADIUS_PX = 5;

export const EDGE_SQUARE_FIXTURE: EdgeSquareFixture = buildEdgeSquareFixture(64, 18, 46);
export const NOISY_PHOTO_EDGE_FIXTURE: EdgeSquareFixture = buildNoisyPhotoEdgeFixture();

export function buildEdgeSquareFixture(size: number, lo: number, hi: number): EdgeSquareFixture {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const value = x >= lo && x < hi && y >= lo && y < hi ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { name: 'filled-square-edge', image: { width: size, height: size, data }, size, lo, hi };
}

export function buildNoisyPhotoEdgeFixture(): EdgeSquareFixture {
  const size = 96;
  const lo = 28;
  const hi = 68;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const inSquare = x >= lo && x < hi && y >= lo && y < hi;
      const backgroundTexture =
        218 +
        Math.round(12 * Math.sin(x * 0.43) + 10 * Math.cos(y * 0.37)) +
        ((x * 19 + y * 23) % 37 === 0 || (x * 11 + y * 7) % 41 === 0 ? -72 : 0);
      const value = inSquare ? 32 + Math.round(8 * Math.sin((x + y) * 0.25)) : backgroundTexture;
      data[offset] = clampByte(value);
      data[offset + 1] = clampByte(value);
      data[offset + 2] = clampByte(value);
      data[offset + 3] = 255;
    }
  }
  return { name: 'noisy-photo-edge', image: { width: size, height: size, data }, size, lo, hi };
}

export function measureSquareEdgeTruth(
  edges: Uint8Array,
  fixture: EdgeSquareFixture,
): SquareEdgeTruthMetrics {
  let edgePixelCount = 0;
  for (const edge of edges) edgePixelCount += edge === 1 ? 1 : 0;
  return {
    edgePixelCount,
    maxInteriorVerticalEdgeClustersPerRow: maxInteriorVerticalEdgeClustersPerRow(edges, fixture),
    maxInteriorHorizontalEdgeClustersPerColumn: maxInteriorHorizontalEdgeClustersPerColumn(
      edges,
      fixture,
    ),
  };
}

export function measureSquareEdgeQuality(
  edges: Uint8Array,
  fixture: EdgeSquareFixture,
): SquareEdgeQualityMetrics {
  const edgePixelCount = countEdgePixels(edges);
  let coveredSamples = 0;
  let maxParallelResponsesPerExpectedEdge = 0;
  const sampleStart = fixture.lo + EDGE_BAND_RADIUS_PX + 1;
  const sampleEnd = fixture.hi - EDGE_BAND_RADIUS_PX - 1;
  const sideSamples = Math.max(0, sampleEnd - sampleStart + 1);
  const totalSamples = sideSamples * 4;

  for (let y = sampleStart; y <= sampleEnd; y += 1) {
    const leftClusters = countRowClustersInBand(edges, fixture.size, y, fixture.lo);
    const rightClusters = countRowClustersInBand(edges, fixture.size, y, fixture.hi);
    if (leftClusters > 0) coveredSamples += 1;
    if (rightClusters > 0) coveredSamples += 1;
    maxParallelResponsesPerExpectedEdge = Math.max(
      maxParallelResponsesPerExpectedEdge,
      leftClusters,
      rightClusters,
    );
  }

  for (let x = sampleStart; x <= sampleEnd; x += 1) {
    const topClusters = countColumnClustersInBand(edges, fixture.size, x, fixture.lo);
    const bottomClusters = countColumnClustersInBand(edges, fixture.size, x, fixture.hi);
    if (topClusters > 0) coveredSamples += 1;
    if (bottomClusters > 0) coveredSamples += 1;
    maxParallelResponsesPerExpectedEdge = Math.max(
      maxParallelResponsesPerExpectedEdge,
      topClusters,
      bottomClusters,
    );
  }

  return {
    edgePixelCount,
    coverageRatio: roundMetric(totalSamples === 0 ? 0 : coveredSamples / totalSamples),
    maxParallelResponsesPerExpectedEdge,
    strayEdgePixelCount: countStrayEdgePixels(edges, fixture),
  };
}

export function measureSquarePathEdgeQuality(
  paths: ReadonlyArray<ColoredPath>,
  fixture: EdgeSquareFixture,
): SquarePathEdgeQualityMetrics {
  const polylines = paths.flatMap((path) => path.polylines);
  const points = polylines.flatMap((polyline) => polyline.points);
  let coveredSamples = 0;
  const sampleStart = fixture.lo + EDGE_BAND_RADIUS_PX + 1;
  const sampleEnd = fixture.hi - EDGE_BAND_RADIUS_PX - 1;
  const sideSamples = Math.max(0, sampleEnd - sampleStart + 1);
  const totalSamples = sideSamples * 4;

  for (let y = sampleStart; y <= sampleEnd; y += 1) {
    if (pathNearSample(polylines, { x: fixture.lo, y })) coveredSamples += 1;
    if (pathNearSample(polylines, { x: fixture.hi, y })) coveredSamples += 1;
  }
  for (let x = sampleStart; x <= sampleEnd; x += 1) {
    if (pathNearSample(polylines, { x, y: fixture.lo })) coveredSamples += 1;
    if (pathNearSample(polylines, { x, y: fixture.hi })) coveredSamples += 1;
  }

  return {
    pointCount: points.length,
    totalPolylineLength: roundMetric(totalPolylineLength(polylines)),
    coverageRatio: roundMetric(totalSamples === 0 ? 0 : coveredSamples / totalSamples),
    strayPointCount: points.filter((point) => !isPointInExpectedPathEdgeBand(point, fixture))
      .length,
  };
}

function totalPolylineLength(
  polylines: ReadonlyArray<{ readonly points: ReadonlyArray<Vec2> }>,
): number {
  let total = 0;
  for (const polyline of polylines) {
    for (let index = 0; index + 1 < polyline.points.length; index += 1) {
      const a = polyline.points[index];
      const b = polyline.points[index + 1];
      if (a !== undefined && b !== undefined) total += Math.hypot(a.x - b.x, a.y - b.y);
    }
  }
  return total;
}

function maxInteriorVerticalEdgeClustersPerRow(
  edges: Uint8Array,
  fixture: EdgeSquareFixture,
): number {
  let max = 0;
  for (let y = fixture.lo + 2; y < fixture.hi - 2; y += 1) {
    max = Math.max(
      max,
      countLineClusters(fixture.size, (x) => edges[y * fixture.size + x] === 1),
    );
  }
  return max;
}

function maxInteriorHorizontalEdgeClustersPerColumn(
  edges: Uint8Array,
  fixture: EdgeSquareFixture,
): number {
  let max = 0;
  for (let x = fixture.lo + 2; x < fixture.hi - 2; x += 1) {
    max = Math.max(
      max,
      countLineClusters(fixture.size, (y) => edges[y * fixture.size + x] === 1),
    );
  }
  return max;
}

function countEdgePixels(edges: Uint8Array): number {
  let count = 0;
  for (const edge of edges) count += edge === 1 ? 1 : 0;
  return count;
}

function countRowClustersInBand(
  edges: Uint8Array,
  size: number,
  y: number,
  centerX: number,
): number {
  return countLineClustersInRange(
    centerX - EDGE_BAND_RADIUS_PX,
    centerX + EDGE_BAND_RADIUS_PX,
    (x) => edgeAt(edges, size, x, y),
  );
}

function countColumnClustersInBand(
  edges: Uint8Array,
  size: number,
  x: number,
  centerY: number,
): number {
  return countLineClustersInRange(
    centerY - EDGE_BAND_RADIUS_PX,
    centerY + EDGE_BAND_RADIUS_PX,
    (y) => edgeAt(edges, size, x, y),
  );
}

function countStrayEdgePixels(edges: Uint8Array, fixture: EdgeSquareFixture): number {
  let count = 0;
  for (let y = 0; y < fixture.size; y += 1) {
    for (let x = 0; x < fixture.size; x += 1) {
      if (!edgeAt(edges, fixture.size, x, y) || isInExpectedEdgeBand(x, y, fixture)) continue;
      count += 1;
    }
  }
  return count;
}

function pathNearSample(
  polylines: ReadonlyArray<{ readonly points: ReadonlyArray<Vec2> }>,
  sample: Vec2,
): boolean {
  return polylines.some((polyline) => polylineNearSample(polyline.points, sample));
}

function polylineNearSample(points: ReadonlyArray<Vec2>, sample: Vec2): boolean {
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point === undefined) continue;
    if (Math.hypot(point.x - sample.x, point.y - sample.y) <= PATH_EDGE_BAND_RADIUS_PX) return true;
    const next = points[i + 1];
    if (next !== undefined && distanceToSegment(sample, point, next) <= PATH_EDGE_BAND_RADIUS_PX) {
      return true;
    }
  }
  return false;
}

function isInExpectedEdgeBand(x: number, y: number, fixture: EdgeSquareFixture): boolean {
  const inVerticalSideRange =
    y >= fixture.lo - EDGE_BAND_RADIUS_PX && y <= fixture.hi + EDGE_BAND_RADIUS_PX;
  const inHorizontalSideRange =
    x >= fixture.lo - EDGE_BAND_RADIUS_PX && x <= fixture.hi + EDGE_BAND_RADIUS_PX;
  const nearLeft = Math.abs(x - fixture.lo) <= EDGE_BAND_RADIUS_PX;
  const nearRight = Math.abs(x - fixture.hi) <= EDGE_BAND_RADIUS_PX;
  const nearTop = Math.abs(y - fixture.lo) <= EDGE_BAND_RADIUS_PX;
  const nearBottom = Math.abs(y - fixture.hi) <= EDGE_BAND_RADIUS_PX;
  return (
    (inVerticalSideRange && (nearLeft || nearRight)) ||
    (inHorizontalSideRange && (nearTop || nearBottom))
  );
}

function isPointInExpectedPathEdgeBand(point: Vec2, fixture: EdgeSquareFixture): boolean {
  const inVerticalSideRange =
    point.y >= fixture.lo - PATH_EDGE_BAND_RADIUS_PX &&
    point.y <= fixture.hi + PATH_EDGE_BAND_RADIUS_PX;
  const inHorizontalSideRange =
    point.x >= fixture.lo - PATH_EDGE_BAND_RADIUS_PX &&
    point.x <= fixture.hi + PATH_EDGE_BAND_RADIUS_PX;
  const nearLeft = Math.abs(point.x - fixture.lo) <= PATH_EDGE_BAND_RADIUS_PX;
  const nearRight = Math.abs(point.x - fixture.hi) <= PATH_EDGE_BAND_RADIUS_PX;
  const nearTop = Math.abs(point.y - fixture.lo) <= PATH_EDGE_BAND_RADIUS_PX;
  const nearBottom = Math.abs(point.y - fixture.hi) <= PATH_EDGE_BAND_RADIUS_PX;
  return (
    (inVerticalSideRange && (nearLeft || nearRight)) ||
    (inHorizontalSideRange && (nearTop || nearBottom))
  );
}

function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function edgeAt(edges: Uint8Array, size: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size && edges[y * size + x] === 1;
}

function countLineClusters(length: number, isEdge: (index: number) => boolean): number {
  return countLineClustersInRange(0, length - 1, isEdge);
}

function countLineClustersInRange(
  start: number,
  end: number,
  isEdge: (index: number) => boolean,
): number {
  let clusters = 0;
  let inCluster = false;
  for (let index = start; index <= end; index += 1) {
    const edge = isEdge(index);
    if (edge && !inCluster) clusters += 1;
    inCluster = edge;
  }
  return clusters;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
