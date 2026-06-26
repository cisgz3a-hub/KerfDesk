// Edge Detection trace (ADR-059): Canny edge map -> Potrace-style contours.
// This mirrors Inkscape's architecture without copying code: detect brightness
// transitions first, close small pixel gaps in the edge bitmap, then run the
// same clean-room contour smoothing used by LaserForge's Line Art backend.
// The result keeps Edge Detection visually distinct from filled logo tracing,
// while curves and corners are continuous instead of graph-walk fragments.

import type { ColoredPath, Polyline, Vec2 } from '../scene';
import type { TraceBitmap } from './potrace-bitmap';
import { cannyEdges, type CannyOptions } from './canny-edges';
import { optimizePotraceCurve } from './potrace-curve-optimize';
import { potraceCurveToPolylinePoints, smoothClosedPolygonToPotraceCurve } from './potrace-curve';
import { lightBurnTraceSettingsToPotraceParams } from './potrace-params';
import { traceBitmapToPotracePaths } from './potrace-path-scanner';
import {
  adjustPotraceVertices,
  calculateBestPotracePolygon,
  calculatePotraceLongestStraightSegments,
} from './potrace-polygon';
import { medianFilter } from './preprocess';
import type { RawImageData, TraceOptions } from './trace-image';

const EDGE_COLOR = '#000000';
const DEFAULT_EDGE_MIN_LENGTH_PX = 3;
const DEFAULT_EDGE_JOIN_GAP_PX = 0;
const EDGE_CONTOUR_CLOSE_RADIUS_PX = 3;
const EDGE_CONTOUR_STROKE_RADIUS_PX = 1;
const EDGE_CONTOUR_CUBIC_SAMPLES = 16;

export function traceImageToEdgePaths(image: RawImageData, options: TraceOptions): ColoredPath[] {
  const edgeSource = options.edgeMedianFilter === false ? image : medianFilter(image);
  const edges = cannyEdges(edgeSource, edgeCannyOptions(options));
  const processed = traceEdgeBitmapContours(edges, image.width, image.height, options);
  return processed.length === 0 ? [] : [{ color: EDGE_COLOR, polylines: processed }];
}

function edgeCannyOptions(options: TraceOptions): CannyOptions {
  return {
    ...(options.edgeBlurSigma === undefined ? {} : { blurSigma: options.edgeBlurSigma }),
    ...(options.edgeLowThresholdRatio === undefined
      ? {}
      : { lowThresholdRatio: options.edgeLowThresholdRatio }),
    ...(options.edgeHighThresholdRatio === undefined
      ? {}
      : { highThresholdRatio: options.edgeHighThresholdRatio }),
  };
}

function traceEdgeBitmapContours(
  edges: Uint8Array,
  width: number,
  height: number,
  options: TraceOptions,
): Polyline[] {
  const params = lightBurnTraceSettingsToPotraceParams(options);
  const requestedMinLengthPx = Math.max(0, options.edgeMinLengthPx ?? DEFAULT_EDGE_MIN_LENGTH_PX);
  const bitmap = removeSmallBitmapComponents(
    edgeMaskToTraceBitmap(edges, width, height, options.edgeJoinGapPx),
    requestedMinLengthPx,
  );
  const paths = traceBitmapToPotracePaths(bitmap, {
    turdsize: params.turdSize,
    turnpolicy: params.turnPolicy,
  });
  const minLengthPx = Math.max(requestedMinLengthPx, blurNoiseFloorPx(options.edgeBlurSigma));
  const polylines: Polyline[] = [];

  for (const path of paths) {
    const longestStraightSegments = calculatePotraceLongestStraightSegments(path.points);
    const polygon = calculateBestPotracePolygon(path.points, longestStraightSegments);
    let vertices = adjustPotraceVertices(path.points, polygon);
    if (path.sign === '-') vertices = [...vertices].reverse();
    if (vertices.length < 2) continue;

    const curve = smoothClosedPolygonToPotraceCurve(vertices, params.alphaMax);
    const optimizedCurve = params.optCurve
      ? optimizePotraceCurve(curve, params.optTolerance)
      : curve;
    const points = potraceCurveToPolylinePoints(optimizedCurve, EDGE_CONTOUR_CUBIC_SAMPLES);
    if (points.length >= 2 && polylineLength(points) >= minLengthPx) {
      polylines.push({ points, closed: true });
    }
  }

  return polylines;
}

function blurNoiseFloorPx(edgeBlurSigma: number | undefined): number {
  if (edgeBlurSigma === undefined || edgeBlurSigma <= 0) return 0;
  return edgeBlurSigma >= 1.5 ? edgeBlurSigma * 10 : 0;
}

function removeSmallBitmapComponents(bitmap: TraceBitmap, minLengthPx: number): TraceBitmap {
  if (minLengthPx <= 0) return bitmap;
  const out = new Uint8Array(bitmap.data.length);
  const visited = new Uint8Array(bitmap.data.length);
  const minimumPixels = Math.max(1, Math.round(minLengthPx));
  for (let index = 0; index < bitmap.data.length; index += 1) {
    if (bitmap.data[index] !== 1 || visited[index] === 1) continue;
    const component = collectBitmapComponent(bitmap, index, visited);
    if (component.length < minimumPixels) continue;
    for (const pixel of component) out[pixel] = 1;
  }
  return { width: bitmap.width, height: bitmap.height, data: out };
}

function collectBitmapComponent(bitmap: TraceBitmap, start: number, visited: Uint8Array): number[] {
  const component: number[] = [];
  const stack = [start];
  visited[start] = 1;
  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined) continue;
    component.push(index);
    for (const neighbor of bitmapNeighborIndices(index, bitmap.width, bitmap.height)) {
      if (bitmap.data[neighbor] !== 1 || visited[neighbor] === 1) continue;
      visited[neighbor] = 1;
      stack.push(neighbor);
    }
  }
  return component;
}

function bitmapNeighborIndices(index: number, width: number, height: number): number[] {
  const x = index % width;
  const y = Math.floor(index / width);
  const neighbors: number[] = [];
  if (x > 0) neighbors.push(index - 1);
  if (x + 1 < width) neighbors.push(index + 1);
  if (y > 0) neighbors.push(index - width);
  if (y + 1 < height) neighbors.push(index + width);
  return neighbors;
}

function edgeMaskToTraceBitmap(
  edges: Uint8Array,
  width: number,
  height: number,
  joinGapPx: number | undefined,
): TraceBitmap {
  const requestedJoinGapPx = Math.max(0, Math.floor(joinGapPx ?? DEFAULT_EDGE_JOIN_GAP_PX));
  const closeRadius =
    requestedJoinGapPx === 0
      ? 0
      : Math.min(5, Math.max(EDGE_CONTOUR_CLOSE_RADIUS_PX, requestedJoinGapPx));
  const erodeRadius =
    closeRadius === 0 ? 0 : Math.max(0, closeRadius - EDGE_CONTOUR_STROKE_RADIUS_PX);
  const base = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (edges[y * width + x] !== 1) continue;
      base[y * width + x] = 1;
    }
  }
  const bridged =
    requestedJoinGapPx === 0
      ? base
      : bridgeDirectionalGaps(
          base,
          width,
          height,
          Math.min(8, Math.max(2, requestedJoinGapPx + 2)),
        );
  const data =
    erodeRadius === 0
      ? bridged
      : erodeMask(dilateMask(bridged, width, height, closeRadius), width, height, erodeRadius);
  return { width, height, data };
}

function paintLine(
  data: Uint8Array,
  width: number,
  height: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): void {
  const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY));
  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    const x = Math.round(fromX + (toX - fromX) * t);
    const y = Math.round(fromY + (toY - fromY) * t);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    data[y * width + x] = 1;
  }
}

function bridgeDirectionalGaps(
  mask: Uint8Array,
  width: number,
  height: number,
  maxDistance: number,
): Uint8Array {
  const out = new Uint8Array(mask);
  const directions = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: -1 },
    { x: 2, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: -1 },
    { x: 1, y: -2 },
  ];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] !== 1) continue;
      for (const direction of directions) {
        bridgeInDirection(out, mask, width, height, x, y, direction.x, direction.y, maxDistance);
      }
    }
  }
  return out;
}

function bridgeInDirection(
  out: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  stepX: number,
  stepY: number,
  maxDistance: number,
): void {
  let sawGap = false;
  for (let step = 1; ; step += 1) {
    const nx = x + stepX * step;
    const ny = y + stepY * step;
    const distance = Math.hypot(nx - x, ny - y);
    if (distance > maxDistance || nx < 0 || ny < 0 || nx >= width || ny >= height) return;
    if (mask[ny * width + nx] === 1) {
      if (sawGap) paintLine(out, width, height, x, y, nx, ny);
      return;
    }
    sawGap = true;
  }
}

function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] !== 1) continue;
      paintDisk(out, width, height, x, y, radius);
    }
  }
  return out;
}

function erodeMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const radiusSquared = radius * radius;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] !== 1) continue;
      if (diskFits(mask, width, height, x, y, radius, radiusSquared)) out[y * width + x] = 1;
    }
  }
  return out;
}

function diskFits(
  mask: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  radiusSquared: number,
): boolean {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radiusSquared) continue;
      const x = centerX + dx;
      const y = centerY + dy;
      if (x < 0 || y < 0 || x >= width || y >= height || mask[y * width + x] !== 1) {
        return false;
      }
    }
  }
  return true;
}

function paintDisk(
  data: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  const radiusSquared = radius * radius;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radiusSquared) continue;
      const x = centerX + dx;
      const y = centerY + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      data[y * width + x] = 1;
    }
  }
}

function polylineLength(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    total += distance(a, b);
  }
  return total;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
