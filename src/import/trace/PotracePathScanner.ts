import type { TraceBitmap } from './TraceBitmap';
import type { PotracePoint } from './PotracePolygonMath';

export type PotraceTurnPolicy = 'black' | 'white' | 'left' | 'right' | 'minority' | 'majority';

export interface PotracePathScanOptions {
  turdsize: number;
  turnpolicy: PotraceTurnPolicy;
}

export interface PotraceScannedPath {
  points: PotracePoint[];
  area: number;
  sign: '+' | '-';
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface MutableBitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

function cloneBitmap(bitmap: TraceBitmap): MutableBitmap {
  return {
    width: bitmap.width,
    height: bitmap.height,
    data: new Uint8Array(bitmap.data),
  };
}

function pointToIndex(bitmap: MutableBitmap, x: number, y: number): number {
  return y * bitmap.width + x;
}

function indexToPoint(bitmap: MutableBitmap, index: number): PotracePoint {
  return {
    x: index % bitmap.width,
    y: Math.floor(index / bitmap.width),
  };
}

function getValueAt(bitmap: MutableBitmap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return false;
  return bitmap.data[pointToIndex(bitmap, x, y)] === 1;
}

function findNext(bitmap: MutableBitmap, start: PotracePoint): PotracePoint | null {
  let index = pointToIndex(bitmap, start.x, start.y);
  while (index < bitmap.data.length && bitmap.data[index] !== 1) {
    index++;
  }
  return index < bitmap.data.length ? indexToPoint(bitmap, index) : null;
}

function majority(bitmap: MutableBitmap, x: number, y: number): boolean {
  for (let radius = 2; radius < 5; radius++) {
    let count = 0;
    for (let offset = -radius + 1; offset <= radius - 1; offset++) {
      count += getValueAt(bitmap, x + offset, y + radius - 1) ? 1 : -1;
      count += getValueAt(bitmap, x + radius - 1, y + offset - 1) ? 1 : -1;
      count += getValueAt(bitmap, x + offset - 1, y - radius) ? 1 : -1;
      count += getValueAt(bitmap, x - radius, y + offset) ? 1 : -1;
    }
    if (count > 0) return true;
    if (count < 0) return false;
  }
  return false;
}

function shouldTurnRight(
  bitmap: MutableBitmap,
  path: PotraceScannedPath,
  x: number,
  y: number,
  turnpolicy: PotraceTurnPolicy,
): boolean {
  if (turnpolicy === 'right') return true;
  if (turnpolicy === 'black' && path.sign === '+') return true;
  if (turnpolicy === 'white' && path.sign === '-') return true;
  if (turnpolicy === 'majority' && majority(bitmap, x, y)) return true;
  if (turnpolicy === 'minority' && !majority(bitmap, x, y)) return true;
  return false;
}

function makePath(start: PotracePoint, bitmap: MutableBitmap): PotraceScannedPath {
  const sign = getValueAt(bitmap, start.x, start.y) ? '+' : '-';
  return {
    points: [],
    area: 0,
    sign,
    minX: start.x,
    minY: start.y,
    maxX: start.x,
    maxY: start.y,
  };
}

function tracePath(
  bitmap: MutableBitmap,
  start: PotracePoint,
  turnpolicy: PotraceTurnPolicy,
): PotraceScannedPath {
  const path = makePath(start, bitmap);
  let x = start.x;
  let y = start.y;
  let dirX = 0;
  let dirY = 1;

  while (true) {
    path.points.push({ x, y });
    path.minX = Math.min(path.minX, x);
    path.minY = Math.min(path.minY, y);
    path.maxX = Math.max(path.maxX, x);
    path.maxY = Math.max(path.maxY, y);

    x += dirX;
    y += dirY;
    path.area -= x * dirY;

    if (x === start.x && y === start.y) {
      break;
    }

    const left = getValueAt(
      bitmap,
      x + (dirX + dirY - 1) / 2,
      y + (dirY - dirX - 1) / 2,
    );
    const right = getValueAt(
      bitmap,
      x + (dirX - dirY - 1) / 2,
      y + (dirY + dirX - 1) / 2,
    );

    if (right && !left) {
      if (shouldTurnRight(bitmap, path, x, y, turnpolicy)) {
        const oldDirX = dirX;
        dirX = -dirY;
        dirY = oldDirX;
      } else {
        const oldDirX = dirX;
        dirX = dirY;
        dirY = -oldDirX;
      }
    } else if (right) {
      const oldDirX = dirX;
      dirX = -dirY;
      dirY = oldDirX;
    } else if (!left) {
      const oldDirX = dirX;
      dirX = dirY;
      dirY = -oldDirX;
    }
  }

  return path;
}

function xorPath(bitmap: MutableBitmap, path: PotraceScannedPath): void {
  let previousY = path.points[0].y;

  for (let index = 1; index < path.points.length; index++) {
    const { x, y } = path.points[index];
    if (y === previousY) continue;

    const minY = Math.min(previousY, y);
    for (let currentX = x; currentX < path.maxX; currentX++) {
      const bitmapIndex = pointToIndex(bitmap, currentX, minY);
      bitmap.data[bitmapIndex] = bitmap.data[bitmapIndex] === 1 ? 0 : 1;
    }
    previousY = y;
  }
}

export function traceBitmapToPotracePaths(
  bitmap: TraceBitmap,
  options: PotracePathScanOptions,
): PotraceScannedPath[] {
  const workingBitmap = cloneBitmap(bitmap);
  const paths: PotraceScannedPath[] = [];
  let current: PotracePoint = { x: 0, y: 0 };

  while (true) {
    const next = findNext(workingBitmap, current);
    if (!next) break;

    current = next;
    const path = tracePath(workingBitmap, current, options.turnpolicy);
    xorPath(workingBitmap, path);
    if (path.area > options.turdsize) {
      paths.push(path);
    }
  }

  return paths;
}
