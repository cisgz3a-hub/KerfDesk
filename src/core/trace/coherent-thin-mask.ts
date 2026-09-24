const MAX_THIN_RUN_PX = 3;
const MIN_THIN_CLUSTER_PIXELS = 12;
const MIN_THIN_CLUSTER_SPAN_PX = 8;

type ThinCluster = {
  readonly pixelCount: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

export function hasCoherentThinDetail(ink: Uint8Array, width: number, height: number): boolean {
  return hasCoherentThinCluster(thinRunMask(ink, width, height), width, height);
}

export function coherentThinMask(
  ink: Uint8Array,
  width: number,
  height: number,
  pixelScale = 1,
): Uint8Array {
  const thin = thinRunMask(ink, width, height, pixelScale);
  const visited = new Uint8Array(thin.length);
  const coherent = new Uint8Array(thin.length);
  for (let index = 0; index < thin.length; index += 1) {
    if (thin[index] === 0 || visited[index] === 1) continue;
    const pixels: number[] = [];
    const cluster = consumeThinCluster(thin, visited, index, width, height, pixels);
    if (isCoherentThinCluster(cluster, pixelScale)) {
      for (const pixel of pixels) coherent[pixel] = 1;
    }
  }
  return coherent;
}

function thinRunMask(ink: Uint8Array, width: number, height: number, pixelScale = 1): Uint8Array {
  const thin = new Uint8Array(ink.length);
  markShortHorizontalRuns(ink, thin, width, height, MAX_THIN_RUN_PX * pixelScale);
  markShortVerticalRuns(ink, thin, width, height, MAX_THIN_RUN_PX * pixelScale);
  return thin;
}

function markShortHorizontalRuns(
  ink: Uint8Array,
  thin: Uint8Array,
  width: number,
  height: number,
  maximumRun: number,
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
      if (x - start <= maximumRun) {
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
  maximumRun: number,
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
      if (y - start <= maximumRun) {
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
    if (isCoherentThinCluster(cluster)) return true;
  }
  return false;
}

function isCoherentThinCluster(cluster: ThinCluster, pixelScale = 1): boolean {
  const span = Math.max(cluster.maxX - cluster.minX + 1, cluster.maxY - cluster.minY + 1);
  return (
    cluster.pixelCount >= MIN_THIN_CLUSTER_PIXELS * pixelScale * pixelScale &&
    span >= MIN_THIN_CLUSTER_SPAN_PX * pixelScale
  );
}

function consumeThinCluster(
  thin: Uint8Array,
  visited: Uint8Array,
  start: number,
  width: number,
  height: number,
  pixels?: number[],
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
    pixels?.push(index);
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
