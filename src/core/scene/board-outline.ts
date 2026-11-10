import type { Bounds, Vec2 } from './scene-object';
import { simplifyClosedRing } from './board-outline-simplify';
import { outlineInsideGrid } from './board-outline-grid';
import { crossAbout, distance, isFinitePoint } from '../geometry/point-math';

export const MAX_BOARD_OUTLINE_POINTS = 512;
export const MAX_BOARD_OUTLINE_ANCHORS = 6;
export type ViewAxisSigns = { readonly x: 1 | -1; readonly y: 1 | -1 };
export type BoardOutlineDraft = {
  /** Board-local mm, top-down, +Y toward the photo bottom, bbox top-left at zero. */
  readonly localPointsMm: ReadonlyArray<Vec2>;
  /** Head-visitable vertices: distinct ascending indices into localPointsMm. */
  readonly anchorIndices: ReadonlyArray<number>;
  /** First two head captures, in order. */
  readonly captureOrder: readonly [number, number];
};

const DUPLICATE_DISTANCE_MM = 0.01;
const MIN_AREA_MM2 = 1;

export function normalizeBoardOutline(points: ReadonlyArray<Vec2>): Vec2[] | null {
  if (points.length < 3 || points.length > MAX_BOARD_OUTLINE_POINTS + 1) return null;
  if (points.some((point) => !isFinitePoint(point))) return null;
  const result: Vec2[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous === undefined || distance(previous, point) >= DUPLICATE_DISTANCE_MM) {
      result.push({ x: point.x, y: point.y });
    }
  }
  if (
    result.length > 1 &&
    distance(result[0] as Vec2, result.at(-1) as Vec2) < DUPLICATE_DISTANCE_MM
  ) {
    result.pop();
  }
  return invalidNormalizedOutline(result) ? null : result;
}

export function simplifyClosedOutline(points: ReadonlyArray<Vec2>, toleranceMm: number): Vec2[] {
  if (points.length <= 3 || !(toleranceMm > 0) || !Number.isFinite(toleranceMm)) {
    return points.slice();
  }
  const simplified = simplifyClosedRing(points, toleranceMm);
  return simplified.length >= 3 ? simplified : points.slice(0, 3);
}

export function boardOutlineAnchors(
  points: ReadonlyArray<Vec2>,
  max = MAX_BOARD_OUTLINE_ANCHORS,
): number[] {
  if (points.length < 2 || max < 2) return [];
  const hull = convexHullIndices(points);
  const candidates = hull
    .map((index, position) => {
      const previous = points[hull[(position - 1 + hull.length) % hull.length] as number] as Vec2;
      const current = points[index] as Vec2;
      const next = points[hull[(position + 1) % hull.length] as number] as Vec2;
      return { index, angle: interiorAngle(previous, current, next) };
    })
    .filter(({ angle }) => angle <= (160 * Math.PI) / 180)
    .sort((left, right) => left.angle - right.angle || left.index - right.index);
  const selected =
    candidates.length >= 2
      ? candidates.slice(0, Math.min(max, candidates.length)).map(({ index }) => index)
      : extremeIndices(points).slice(0, max);
  return [...new Set(selected)].sort((left, right) => left - right);
}

export function defaultCaptureOrder(
  points: ReadonlyArray<Vec2>,
  anchors: ReadonlyArray<number>,
): readonly [number, number] | null {
  const valid = [...new Set(anchors)].filter((index) => points[index] !== undefined);
  if (valid.length < 2) return null;
  const bounds = outlineBounds(points);
  const target = { x: bounds.minX, y: bounds.maxY };
  const first = valid.reduce((best, index) =>
    distance(points[index] as Vec2, target) < distance(points[best] as Vec2, target) ? index : best,
  );
  const second = valid
    .filter((index) => index !== first)
    .reduce((best, index) =>
      distance(points[index] as Vec2, points[first] as Vec2) >
      distance(points[best] as Vec2, points[first] as Vec2)
        ? index
        : best,
    );
  return [first, second];
}

export function sizeBoardOutline(
  points: ReadonlyArray<Vec2>,
  widthMm: number,
  heightMm: number,
): Vec2[] | null {
  if (!(widthMm > 0) || !(heightMm > 0) || !Number.isFinite(widthMm + heightMm)) return null;
  if (points.length < 3 || points.some((point) => !isFinitePoint(point))) return null;
  const bounds = outlineBounds(points);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!(width > 0) || !(height > 0)) return null;
  return points.map((point) => ({
    x: ((point.x - bounds.minX) * widthMm) / width,
    y: ((point.y - bounds.minY) * heightMm) / height,
  }));
}

export function boardOutlineDraft(
  points: ReadonlyArray<Vec2>,
  widthMm: number,
  heightMm: number,
): BoardOutlineDraft | null {
  const normalized = normalizeBoardOutline(points);
  if (normalized === null) return null;
  const localPointsMm = sizeBoardOutline(normalized, widthMm, heightMm);
  if (localPointsMm === null) return null;
  const anchorIndices = boardOutlineAnchors(localPointsMm);
  const captureOrder = defaultCaptureOrder(localPointsMm, anchorIndices);
  return captureOrder === null ? null : { localPointsMm, anchorIndices, captureOrder };
}

export function outlineBounds(points: ReadonlyArray<Vec2>): Bounds {
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function pointInPolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous] as Vec2;
    const b = polygon[index] as Vec2;
    if (pointOnSegment(point, a, b)) return true;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function largestInscribedRect(polygon: ReadonlyArray<Vec2>): Bounds | null {
  if (polygon.length < 3) return null;
  const bounds = outlineBounds(polygon);
  const longSide = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const cell = Math.max(0.5, longSide / 128);
  const columns = Math.floor((bounds.maxX - bounds.minX) / cell);
  const rows = Math.floor((bounds.maxY - bounds.minY) / cell);
  if (columns < 3 || rows < 3) return null;
  const grid = outlineInsideGrid(polygon, bounds, cell, rows, columns);
  const best = maximalGridRect(grid);
  if (best === null || best.right - best.left < 2 || best.bottom - best.top < 2) return null;
  return {
    minX: bounds.minX + (best.left + 1) * cell,
    minY: bounds.minY + (best.top + 1) * cell,
    maxX: bounds.minX + (best.right - 1) * cell,
    maxY: bounds.minY + (best.bottom - 1) * cell,
  };
}

type GridRect = { left: number; right: number; top: number; bottom: number; area: number };

function maximalGridRect(grid: ReadonlyArray<ReadonlyArray<boolean>>): GridRect | null {
  const heights = Array<number>(grid[0]?.length ?? 0).fill(0);
  let best: GridRect | null = null;
  grid.forEach((row, rowIndex) => {
    row.forEach((inside, column) => {
      heights[column] = inside ? (heights[column] ?? 0) + 1 : 0;
    });
    const stack: number[] = [];
    for (let column = 0; column <= heights.length; column += 1) {
      const height = column === heights.length ? 0 : (heights[column] ?? 0);
      while (stack.length > 0 && (heights[stack.at(-1) as number] ?? 0) > height) {
        const at = stack.pop() as number;
        const h = heights[at] as number;
        const left = (stack.at(-1) ?? -1) + 1;
        const area = h * (column - left);
        if (best === null || area > best.area) {
          best = { left, right: column, top: rowIndex + 1 - h, bottom: rowIndex + 1, area };
        }
      }
      stack.push(column);
    }
  });
  return best;
}

function selfIntersects(points: ReadonlyArray<Vec2>): boolean {
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      if (right === left + 1 || (left === 0 && right === points.length - 1)) continue;
      if (
        segmentsIntersect(
          points[left] as Vec2,
          points[(left + 1) % points.length] as Vec2,
          points[right] as Vec2,
          points[(right + 1) % points.length] as Vec2,
        )
      )
        return true;
    }
  }
  return false;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const abC = crossAbout(a, b, c);
  const abD = crossAbout(a, b, d);
  const cdA = crossAbout(c, d, a);
  const cdB = crossAbout(c, d, b);
  if (oppositeSigns(abC, abD) && oppositeSigns(cdA, cdB)) return true;
  return (
    (Math.abs(abC) < 1e-9 && pointOnSegment(c, a, b)) ||
    (Math.abs(abD) < 1e-9 && pointOnSegment(d, a, b)) ||
    (Math.abs(cdA) < 1e-9 && pointOnSegment(a, c, d)) ||
    (Math.abs(cdB) < 1e-9 && pointOnSegment(b, c, d))
  );
}

function oppositeSigns(left: number, right: number): boolean {
  return (left > 0 && right < 0) || (left < 0 && right > 0);
}

function pointOnSegment(point: Vec2, a: Vec2, b: Vec2): boolean {
  return (
    Math.abs(crossAbout(a, b, point)) < 1e-9 &&
    point.x >= Math.min(a.x, b.x) - 1e-9 &&
    point.x <= Math.max(a.x, b.x) + 1e-9 &&
    point.y >= Math.min(a.y, b.y) - 1e-9 &&
    point.y <= Math.max(a.y, b.y) + 1e-9
  );
}

function convexHullIndices(points: ReadonlyArray<Vec2>): number[] {
  const sorted = points
    .map((point, index) => ({ point, index }))
    .sort((a, b) => a.point.x - b.point.x || a.point.y - b.point.y || a.index - b.index);
  const half = (items: typeof sorted): typeof sorted => {
    const hull: typeof sorted = [];
    for (const item of items) {
      while (lastHullTurnIsClockwise(hull, item.point)) hull.pop();
      hull.push(item);
    }
    return hull;
  };
  return [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)].map(
    ({ index }) => index,
  );
}

function lastHullTurnIsClockwise(
  hull: ReadonlyArray<{ readonly point: Vec2 }>,
  point: Vec2,
): boolean {
  const previous = hull[hull.length - 2]?.point;
  const current = hull[hull.length - 1]?.point;
  return (
    previous !== undefined && current !== undefined && crossAbout(previous, current, point) <= 0
  );
}

function extremeIndices(points: ReadonlyArray<Vec2>): number[] {
  const choose = (score: (point: Vec2) => number): number =>
    points.reduce(
      (best, point, index) => (score(point) < score(points[best] as Vec2) ? index : best),
      0,
    );
  return [
    ...new Set([
      choose((point) => point.x),
      choose((point) => -point.x),
      choose((point) => point.y),
      choose((point) => -point.y),
    ]),
  ];
}

function interiorAngle(previous: Vec2, current: Vec2, next: Vec2): number {
  const a = { x: previous.x - current.x, y: previous.y - current.y };
  const b = { x: next.x - current.x, y: next.y - current.y };
  return Math.acos(
    Math.max(
      -1,
      Math.min(1, (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))),
    ),
  );
}

function signedArea(points: ReadonlyArray<Vec2>): number {
  return (
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length] as Vec2;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2
  );
}

function invalidNormalizedOutline(points: ReadonlyArray<Vec2>): boolean {
  return (
    points.length < 3 ||
    points.length > MAX_BOARD_OUTLINE_POINTS ||
    Math.abs(signedArea(points)) < MIN_AREA_MM2 ||
    selfIntersects(points)
  );
}
