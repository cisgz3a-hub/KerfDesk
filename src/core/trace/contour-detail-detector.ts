import {
  isValidRawImageData,
  prepareTraceForContour,
  type RawImageData,
  type TraceOptions,
} from './trace-image';

const INK_LUMA_CUTOFF = 128;
const MAX_THIN_RUN_PX = 3;
const MIN_THIN_CLUSTER_PIXELS = 12;
const MIN_THIN_CLUSTER_SPAN_PX = 8;
const RGBA_CHANNELS = 4;

type ThinCluster = {
  readonly pixelCount: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

export type ContourDetailProfile = {
  readonly hasThinDetail: boolean;
  readonly transitionDensity: number;
};

/**
 * Reports whether a cleaned contour mask contains a coherent feature only a
 * few source pixels wide. Those are the features that materially benefit from
 * a 2x mask before contour extraction; broad solid artwork does not.
 */
export function hasSupersampleWorthyContourDetail(
  image: RawImageData,
  options: TraceOptions,
): boolean {
  return contourDetailProfile(image, options).hasThinDetail;
}

/** Measures narrow detail and overall mask complexity in one preprocessing pass. */
export function contourDetailProfile(
  image: RawImageData,
  options: TraceOptions,
): ContourDetailProfile {
  if (!isValidRawImageData(image)) return { hasThinDetail: false, transitionDensity: 0 };

  const prepared = prepareTraceForContour(image, { ...options, pixelScale: 1 }).prepared;
  const ink = inkMask(prepared);
  const thin = thinRunMask(ink, prepared.width, prepared.height);
  return {
    hasThinDetail: hasCoherentThinCluster(thin, prepared.width, prepared.height),
    transitionDensity: maskTransitionDensity(ink, prepared.width, prepared.height),
  };
}

function inkMask(image: RawImageData): Uint8Array {
  const ink = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < ink.length; pixel += 1) {
    ink[pixel] = (image.data[pixel * RGBA_CHANNELS] ?? 255) < INK_LUMA_CUTOFF ? 1 : 0;
  }
  return ink;
}

function thinRunMask(ink: Uint8Array, width: number, height: number): Uint8Array {
  const thin = new Uint8Array(ink.length);
  markShortHorizontalRuns(ink, thin, width, height);
  markShortVerticalRuns(ink, thin, width, height);
  return thin;
}

function maskTransitionDensity(ink: Uint8Array, width: number, height: number): number {
  const possibleTransitions = (width - 1) * height + (height - 1) * width;
  if (possibleTransitions <= 0) return 0;
  let transitions = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x > 0 && ink[index] !== ink[index - 1]) transitions += 1;
      if (y > 0 && ink[index] !== ink[index - width]) transitions += 1;
    }
  }
  return transitions / possibleTransitions;
}

function markShortHorizontalRuns(
  ink: Uint8Array,
  thin: Uint8Array,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      if (ink[y * width + x] === 0) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < width && ink[y * width + x] === 1) x += 1;
      if (x - start <= MAX_THIN_RUN_PX) {
        for (let runX = start; runX < x; runX += 1) thin[y * width + runX] = 1;
      }
    }
  }
}

function markShortVerticalRuns(
  ink: Uint8Array,
  thin: Uint8Array,
  width: number,
  height: number,
): void {
  for (let x = 0; x < width; x += 1) {
    let y = 0;
    while (y < height) {
      if (ink[y * width + x] === 0) {
        y += 1;
        continue;
      }
      const start = y;
      while (y < height && ink[y * width + x] === 1) y += 1;
      if (y - start <= MAX_THIN_RUN_PX) {
        for (let runY = start; runY < y; runY += 1) thin[runY * width + x] = 1;
      }
    }
  }
}

function hasCoherentThinCluster(thin: Uint8Array, width: number, height: number): boolean {
  const visited = new Uint8Array(thin.length);
  for (let index = 0; index < thin.length; index += 1) {
    if (thin[index] === 0 || visited[index] === 1) continue;
    const cluster = consumeThinCluster(thin, visited, index, width, height);
    const span = Math.max(cluster.maxX - cluster.minX + 1, cluster.maxY - cluster.minY + 1);
    if (cluster.pixelCount >= MIN_THIN_CLUSTER_PIXELS && span >= MIN_THIN_CLUSTER_SPAN_PX) {
      return true;
    }
  }
  return false;
}

function consumeThinCluster(
  thin: Uint8Array,
  visited: Uint8Array,
  start: number,
  width: number,
  height: number,
): ThinCluster {
  const stack = [start];
  visited[start] = 1;
  let pixelCount = 0;
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;

  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined) break;
    const x = index % width;
    const y = Math.floor(index / width);
    pixelCount += 1;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    pushThinNeighbours(thin, visited, stack, x, y, width, height);
  }

  return { pixelCount, minX, maxX, minY, maxY };
}

function pushThinNeighbours(
  thin: Uint8Array,
  visited: Uint8Array,
  stack: number[],
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
      const next = nextY * width + nextX;
      if (thin[next] === 0 || visited[next] === 1) continue;
      visited[next] = 1;
      stack.push(next);
    }
  }
}
