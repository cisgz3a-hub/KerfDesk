// Warp (4 point) and Deform (16 point) maps (LightBurn gap LBG-T06). Both map
// the selection's box onto handles the user drags:
// - Warp is the projective map (homography) from the box corners onto the
//   four handles, so straight lines stay straight. When the handles make a
//   quadrilateral no projective map can reach without sending part of the box
//   to infinity (one corner dragged inside the others, or the handles crossed),
//   it falls back to the bilinear map, which always exists and folds over.
// - Deform is the bicubic Bezier patch (tensor-product Bernstein) whose 4 x 4
//   control points are the handles. Evenly spaced handles reproduce the box.

import { applyHomography, solveHomography, type Mat3 } from '../camera/homography';
import type { Bounds, Vec2 } from '../scene/scene-object';

export type WarpDeformGrid = 'warp' | 'deform';

export type PointMap = {
  readonly apply: (point: Vec2) => Vec2;
  /** True for a projective map: every straight line stays straight, so no segment needs splitting. */
  readonly keepsLinesStraight: boolean;
  /** The smallest span, in millimetres, over which the map can bend a line one way and back. */
  readonly featureSizeMm: number;
};

/** Handles along each side of the Deform grid. */
export const DEFORM_GRID_SIDE = 4;
const DEFORM_HANDLE_COUNT = DEFORM_GRID_SIDE * DEFORM_GRID_SIDE;
const WARP_HANDLE_COUNT = 4;
const MIN_BOX_SIDE_MM = 1;
const MIN_BOX_SIDE_RATIO = 0.1;
const HANDLE_MATCH_MM = 1e-9;
const CORNER_MATCH_RATIO = 1e-6;
const STRETCH_SAMPLES = 9;
const STRETCH_STEP = 1e-4;
const MAX_STRETCH = 1000;

/**
 * The box the handles start on: the selection bounds, with a side that has no
 * length (a straight horizontal or vertical line) opened up to a tenth of the
 * other side, at least 1 mm, so the handles have somewhere to sit.
 */
export function warpDeformBox(bounds: Bounds): Bounds {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const minSide = Math.max(MIN_BOX_SIDE_MM, MIN_BOX_SIDE_RATIO * Math.max(width, height));
  const padX = width >= minSide ? 0 : (minSide - width) / 2;
  const padY = height >= minSide ? 0 : (minSide - height) / 2;
  return {
    minX: bounds.minX - padX,
    minY: bounds.minY - padY,
    maxX: bounds.maxX + padX,
    maxY: bounds.maxY + padY,
  };
}

/**
 * Handles that leave the artwork where it is. Warp: the box corners in order
 * round the box, starting at (minX, minY). Deform: a 4 x 4 grid, row by row
 * from minY, each row from minX.
 */
export function initialWarpDeformHandles(grid: WarpDeformGrid, box: Bounds): ReadonlyArray<Vec2> {
  if (grid === 'warp') {
    return [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
    ];
  }
  const last = DEFORM_GRID_SIDE - 1;
  const handles: Vec2[] = [];
  for (let row = 0; row < DEFORM_GRID_SIDE; row += 1) {
    for (let col = 0; col < DEFORM_GRID_SIDE; col += 1) {
      handles.push({
        x: box.minX + ((box.maxX - box.minX) * col) / last,
        y: box.minY + ((box.maxY - box.minY) * row) / last,
      });
    }
  }
  return handles;
}

export function warpDeformHandlesUnmoved(
  grid: WarpDeformGrid,
  box: Bounds,
  handles: ReadonlyArray<Vec2>,
): boolean {
  const start = initialWarpDeformHandles(grid, box);
  return (
    start.length === handles.length &&
    start.every((point, index) => {
      const handle = handles[index];
      return (
        handle !== undefined &&
        Math.abs(handle.x - point.x) <= HANDLE_MATCH_MM &&
        Math.abs(handle.y - point.y) <= HANDLE_MATCH_MM
      );
    })
  );
}

export function warpDeformMap(
  grid: WarpDeformGrid,
  box: Bounds,
  handles: ReadonlyArray<Vec2>,
): PointMap {
  return grid === 'warp' ? warpMap(box, handles) : deformMap(box, handles);
}

/** The projective map from the box corners onto four handles, or the bilinear map when none fits. */
export function warpMap(box: Bounds, handles: ReadonlyArray<Vec2>): PointMap {
  const corners = handles.slice(0, WARP_HANDLE_COUNT);
  if (corners.length !== WARP_HANDLE_COUNT) return identityMap();
  const toUnit = unitCoordinates(box);
  const matrix = projectiveMatrix(corners);
  if (matrix !== null) {
    return {
      apply: withExactCorners(box, corners, (point) => applyHomography(matrix, toUnit(point))),
      keepsLinesStraight: true,
      featureSizeMm: Number.POSITIVE_INFINITY,
    };
  }
  const [p0, p1, p2, p3] = corners as [Vec2, Vec2, Vec2, Vec2];
  return {
    apply: (point) => {
      const { x: u, y: v } = toUnit(point);
      const a = (1 - u) * (1 - v);
      const b = u * (1 - v);
      const c = u * v;
      const d = (1 - u) * v;
      return {
        x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
        y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
      };
    },
    keepsLinesStraight: false,
    featureSizeMm: Math.min(box.maxX - box.minX, box.maxY - box.minY),
  };
}

/** The bicubic Bezier patch over the box whose control points are the 16 handles. */
export function deformMap(box: Bounds, handles: ReadonlyArray<Vec2>): PointMap {
  if (handles.length !== DEFORM_HANDLE_COUNT) return identityMap();
  const toUnit = unitCoordinates(box);
  const xs = handles.map((handle) => handle.x);
  const ys = handles.map((handle) => handle.y);
  const last = DEFORM_GRID_SIDE - 1;
  const corners = [0, last, DEFORM_HANDLE_COUNT - 1, DEFORM_HANDLE_COUNT - 1 - last].map(
    (index) => handles[index] as Vec2,
  );
  return {
    apply: withExactCorners(box, corners, (point) => {
      const unit = toUnit(point);
      const bu = cubicBernstein(unit.x);
      const bv = cubicBernstein(unit.y);
      let x = 0;
      let y = 0;
      for (let row = 0; row < DEFORM_GRID_SIDE; row += 1) {
        for (let col = 0; col < DEFORM_GRID_SIDE; col += 1) {
          const weight = (bv[row] ?? 0) * (bu[col] ?? 0);
          const index = row * DEFORM_GRID_SIDE + col;
          x += weight * (xs[index] ?? 0);
          y += weight * (ys[index] ?? 0);
        }
      }
      return { x, y };
    }),
    keepsLinesStraight: false,
    featureSizeMm: Math.min(box.maxX - box.minX, box.maxY - box.minY) / (DEFORM_GRID_SIDE - 1),
  };
}

/**
 * The most the map stretches any short piece of the box, sampled on a grid:
 * how far a flattening error in the source can grow after mapping. At least 1.
 */
export function warpDeformStretch(map: PointMap, box: Bounds): number {
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const stepX = Math.max(width * STRETCH_STEP, Number.EPSILON);
  const stepY = Math.max(height * STRETCH_STEP, Number.EPSILON);
  let stretch = 1;
  for (let row = 0; row < STRETCH_SAMPLES; row += 1) {
    for (let col = 0; col < STRETCH_SAMPLES; col += 1) {
      const u = col / (STRETCH_SAMPLES - 1);
      const v = row / (STRETCH_SAMPLES - 1);
      // Step inward from the far sides so every sample stays inside the box.
      const x = box.minX + width * u - (u === 1 ? stepX : 0);
      const y = box.minY + height * v - (v === 1 ? stepY : 0);
      stretch = Math.max(stretch, localStretch(map, { x, y }, stepX, stepY));
    }
  }
  return Number.isFinite(stretch) ? Math.min(stretch, MAX_STRETCH) : MAX_STRETCH;
}

// The largest singular value of the finite-difference Jacobian at `point`.
function localStretch(map: PointMap, point: Vec2, stepX: number, stepY: number): number {
  const origin = map.apply(point);
  const alongX = map.apply({ x: point.x + stepX, y: point.y });
  const alongY = map.apply({ x: point.x, y: point.y + stepY });
  const a = (alongX.x - origin.x) / stepX;
  const c = (alongX.y - origin.y) / stepX;
  const b = (alongY.x - origin.x) / stepY;
  const d = (alongY.y - origin.y) / stepY;
  const sum = a * a + b * b + c * c + d * d;
  const det = a * d - b * c;
  return Math.sqrt((sum + Math.sqrt(Math.max(0, sum * sum - 4 * det * det))) / 2);
}

// The homography from the unit square onto the four handles, or null when the
// perspective divide changes sign inside the square (the handles are not a
// convex quadrilateral) or the solve fails.
function projectiveMatrix(corners: ReadonlyArray<Vec2>): Mat3 | null {
  const unit: ReadonlyArray<Vec2> = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const solved = solveHomography(unit.map((src, index) => ({ src, dst: corners[index] ?? src })));
  if (!solved.ok || !solved.matrix.every(Number.isFinite)) return null;
  const matrix = solved.matrix;
  // w is affine in (u, v), so positive at the four corners means positive
  // everywhere in the square: no point of the box is sent to infinity.
  const positive = unit.every(
    (corner) => matrix[6] * corner.x + matrix[7] * corner.y + matrix[8] > 0,
  );
  return positive && mapsCornersOntoHandles(matrix, unit, corners) ? matrix : null;
}

function mapsCornersOntoHandles(
  matrix: Mat3,
  unit: ReadonlyArray<Vec2>,
  corners: ReadonlyArray<Vec2>,
): boolean {
  const scale = Math.max(1, ...corners.map((corner) => Math.hypot(corner.x, corner.y)));
  return unit.every((corner, index) => {
    const mapped = applyHomography(matrix, corner);
    const handle = corners[index];
    return (
      handle !== undefined &&
      Math.hypot(mapped.x - handle.x, mapped.y - handle.y) <= scale * CORNER_MATCH_RATIO
    );
  });
}

// Dividing (rather than multiplying by the reciprocal) makes the far sides exactly 1.
function unitCoordinates(box: Bounds): (point: Vec2) => Vec2 {
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  return (point) => ({
    x: width > 0 ? (point.x - box.minX) / width : 0,
    y: height > 0 ? (point.y - box.minY) / height : 0,
  });
}

// Both maps send the box corners onto the corner handles; answer those exactly
// rather than to rounding, so a corner lands precisely where the user put it.
function withExactCorners(
  box: Bounds,
  corners: ReadonlyArray<Vec2>,
  apply: (point: Vec2) => Vec2,
): (point: Vec2) => Vec2 {
  return (point) => {
    const left = point.x === box.minX;
    const top = point.y === box.minY;
    const onCorner = (left || point.x === box.maxX) && (top || point.y === box.maxY);
    if (!onCorner) return apply(point);
    const index = top ? (left ? 0 : 1) : left ? 3 : 2;
    return corners[index] ?? apply(point);
  };
}

function cubicBernstein(t: number): readonly [number, number, number, number] {
  const s = 1 - t;
  return [s * s * s, 3 * t * s * s, 3 * t * t * s, t * t * t];
}

function identityMap(): PointMap {
  return {
    apply: (point) => point,
    keepsLinesStraight: true,
    featureSizeMm: Number.POSITIVE_INFINITY,
  };
}
