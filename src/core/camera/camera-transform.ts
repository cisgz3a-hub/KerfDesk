import type { CameraAlignment, CameraAlignmentPoint, CameraPoint } from './camera-profile';

export type CameraTransformResult =
  | {
      readonly kind: 'ok';
      readonly imageToMachine: (point: CameraPoint) => CameraPoint;
      readonly machineToImage: (point: CameraPoint) => CameraPoint;
      readonly imageToMachineMatrix: CameraHomography;
      readonly machineToImageMatrix: CameraHomography;
    }
  | { readonly kind: 'invalid'; readonly reason: string };

export type CameraHomography = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const EPSILON = 1e-9;
const MIN_NORMALIZED_TRIANGLE_AREA = 1e-3;
const MAX_MACHINE_ALIGNMENT_RESIDUAL_MM = 2;
const MAX_IMAGE_ALIGNMENT_RESIDUAL_PX = 4;

export function buildCameraTransforms(
  alignment: CameraAlignment | undefined,
): CameraTransformResult {
  const shapeError = validateAlignmentShape(alignment);
  if (shapeError !== null) return { kind: 'invalid', reason: shapeError };
  if (alignment === undefined) return { kind: 'invalid', reason: 'camera alignment is missing' };

  const geometryError = validateAlignmentGeometry(alignment);
  if (geometryError !== null) return { kind: 'invalid', reason: geometryError };

  const imageToMachineMatrix = homographyFromPairs(alignment.points);
  if (imageToMachineMatrix === null) {
    return { kind: 'invalid', reason: 'camera alignment could not be solved' };
  }
  const machineToImageMatrix = invertHomography(imageToMachineMatrix);
  if (machineToImageMatrix === null) {
    return { kind: 'invalid', reason: 'camera alignment inverse could not be solved' };
  }
  const residualError = validateAlignmentResidual(
    alignment,
    imageToMachineMatrix,
    machineToImageMatrix,
  );
  if (residualError !== null) return { kind: 'invalid', reason: residualError };
  return {
    kind: 'ok',
    imageToMachine: (point) => applyHomography(imageToMachineMatrix, point),
    machineToImage: (point) => applyHomography(machineToImageMatrix, point),
    imageToMachineMatrix,
    machineToImageMatrix,
  };
}

function validateAlignmentShape(alignment: CameraAlignment | undefined): string | null {
  if (alignment === undefined) return 'camera alignment is missing';
  if (!Array.isArray(alignment.points) || alignment.points.length < 4) {
    return 'camera alignment needs at least 4 points';
  }
  return alignment.points.every(hasValidPointPair) ? null : 'camera alignment is invalid';
}

function hasValidPointPair(pair: CameraAlignmentPoint): boolean {
  return isPoint(pair.image) && isPoint(pair.machine);
}

function validateAlignmentGeometry(alignment: CameraAlignment): string | null {
  const imagePoints = alignment.points.map((point) => point.image);
  const machinePoints = alignment.points.map((point) => point.machine);
  if (!pointsAreUnique(imagePoints)) return 'camera alignment image points are not unique';
  if (!pointsAreUnique(machinePoints)) return 'camera alignment machine points are not unique';
  if (!hasNonCollinearTriple(imagePoints)) return 'camera alignment image points are collinear';
  if (!hasNonCollinearTriple(machinePoints)) {
    return 'camera alignment machine points are collinear';
  }
  if (!hasStablePointSpread(imagePoints)) {
    return 'camera alignment image points are nearly collinear';
  }
  if (!hasStablePointSpread(machinePoints)) {
    return 'camera alignment machine points are nearly collinear';
  }
  return null;
}

function validateAlignmentResidual(
  alignment: CameraAlignment,
  imageToMachineMatrix: CameraHomography,
  machineToImageMatrix: CameraHomography,
): string | null {
  let maxMachineResidual = 0;
  let maxImageResidual = 0;
  for (const pair of alignment.points) {
    const machine = applyHomography(imageToMachineMatrix, pair.image);
    const image = applyHomography(machineToImageMatrix, pair.machine);
    if (!isPoint(machine) || !isPoint(image)) return 'camera alignment residual is too high';
    maxMachineResidual = Math.max(maxMachineResidual, pointDistance(machine, pair.machine));
    maxImageResidual = Math.max(maxImageResidual, pointDistance(image, pair.image));
  }
  return maxMachineResidual > MAX_MACHINE_ALIGNMENT_RESIDUAL_MM ||
    maxImageResidual > MAX_IMAGE_ALIGNMENT_RESIDUAL_PX
    ? 'camera alignment residual is too high'
    : null;
}

function homographyFromPairs(pairs: ReadonlyArray<CameraAlignmentPoint>): CameraHomography | null {
  const rows: number[][] = [];
  const values: number[] = [];
  for (const pair of pairs) {
    const { x: u, y: v } = pair.image;
    const { x, y } = pair.machine;
    rows.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    values.push(x);
    rows.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    values.push(y);
  }
  const solved = solveLeastSquares(rows, values, 8);
  return solved === null ? null : homographyFromSolved(solved);
}

function homographyFromSolved(solved: ReadonlyArray<number>): CameraHomography | null {
  const h0 = solved[0];
  const h1 = solved[1];
  const h2 = solved[2];
  const h3 = solved[3];
  const h4 = solved[4];
  const h5 = solved[5];
  const h6 = solved[6];
  const h7 = solved[7];
  if (
    h0 === undefined ||
    h1 === undefined ||
    h2 === undefined ||
    h3 === undefined ||
    h4 === undefined ||
    h5 === undefined ||
    h6 === undefined ||
    h7 === undefined
  ) {
    return null;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7, 1];
}

function solveLeastSquares(
  rows: ReadonlyArray<ReadonlyArray<number>>,
  values: ReadonlyArray<number>,
  unknowns: number,
): ReadonlyArray<number> | null {
  const normalRows = Array.from({ length: unknowns }, () => Array(unknowns).fill(0));
  const normalValues = Array(unknowns).fill(0);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    if (!accumulateNormalEquation(rows[rowIndex], values[rowIndex], normalRows, normalValues)) {
      return null;
    }
  }
  return solveLinearSystem(normalRows, normalValues);
}

function accumulateNormalEquation(
  row: ReadonlyArray<number> | undefined,
  value: number | undefined,
  normalRows: number[][],
  normalValues: number[],
): boolean {
  if (row === undefined || value === undefined) return false;
  for (let i = 0; i < normalRows.length; i++) {
    const rowI = row[i];
    const normalRow = normalRows[i];
    if (rowI === undefined || normalRow === undefined) return false;
    normalValues[i] = (normalValues[i] ?? 0) + rowI * value;
    for (let j = 0; j < normalRows.length; j++) {
      const rowJ = row[j];
      if (rowJ === undefined) return false;
      normalRow[j] = (normalRow[j] ?? 0) + rowI * rowJ;
    }
  }
  return true;
}

function solveLinearSystem(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  values: ReadonlyArray<number>,
): ReadonlyArray<number> | null {
  const n = values.length;
  const a = augmentedMatrix(matrix, values);
  if (a === null) return null;

  for (let col = 0; col < n; col++) {
    const pivot = findPivotRow(a, col);
    if (pivot === null) return null;
    swapRows(a, pivot, col);
    normalizePivotRow(a, col, n);
    eliminateColumn(a, col, n);
  }

  return a.map((row) => row[n] ?? 0);
}

function augmentedMatrix(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  values: ReadonlyArray<number>,
): number[][] | null {
  const rows = matrix.map((row, index) => {
    const value = values[index];
    return value === undefined ? null : [...row, value];
  });
  if (rows.some((row) => row === null || row.length !== values.length + 1)) return null;
  return rows as number[][];
}

function findPivotRow(rows: number[][], col: number): number | null {
  let pivot = col;
  for (let row = col + 1; row < rows.length; row++) {
    if (Math.abs(valueAt(rows, row, col)) > Math.abs(valueAt(rows, pivot, col))) pivot = row;
  }
  return Math.abs(valueAt(rows, pivot, col)) < EPSILON ? null : pivot;
}

function swapRows(rows: number[][], first: number, second: number): void {
  if (first === second) return;
  const firstRow = rows[first];
  const secondRow = rows[second];
  if (firstRow === undefined || secondRow === undefined) return;
  rows[first] = secondRow;
  rows[second] = firstRow;
}

function normalizePivotRow(rows: number[][], col: number, lastColumn: number): void {
  const row = rows[col];
  if (row === undefined) return;
  const pivotValue = row[col] ?? 1;
  for (let j = col; j <= lastColumn; j++) row[j] = (row[j] ?? 0) / pivotValue;
}

function eliminateColumn(rows: number[][], col: number, lastColumn: number): void {
  const pivotRow = rows[col];
  if (pivotRow === undefined) return;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    if (rowIndex === col) continue;
    const row = rows[rowIndex];
    if (row === undefined) continue;
    const factor = row[col] ?? 0;
    for (let j = col; j <= lastColumn; j++) row[j] = (row[j] ?? 0) - factor * (pivotRow[j] ?? 0);
  }
}

function valueAt(rows: ReadonlyArray<ReadonlyArray<number>>, row: number, col: number): number {
  return rows[row]?.[col] ?? 0;
}

function applyHomography(matrix: CameraHomography, point: CameraPoint): CameraPoint {
  const denom = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (Math.abs(denom) < EPSILON) return { x: Number.NaN, y: Number.NaN };
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denom,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denom,
  };
}

function invertHomography(matrix: CameraHomography): CameraHomography | null {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const cofactor00 = e * i - f * h;
  const cofactor01 = c * h - b * i;
  const cofactor02 = b * f - c * e;
  const cofactor10 = f * g - d * i;
  const cofactor11 = a * i - c * g;
  const cofactor12 = c * d - a * f;
  const cofactor20 = d * h - e * g;
  const cofactor21 = b * g - a * h;
  const cofactor22 = a * e - b * d;
  const determinant = a * cofactor00 + b * cofactor10 + c * cofactor20;
  if (Math.abs(determinant) < EPSILON) return null;
  return [
    cofactor00 / determinant,
    cofactor01 / determinant,
    cofactor02 / determinant,
    cofactor10 / determinant,
    cofactor11 / determinant,
    cofactor12 / determinant,
    cofactor20 / determinant,
    cofactor21 / determinant,
    cofactor22 / determinant,
  ];
}

function pointsAreUnique(points: ReadonlyArray<CameraPoint>): boolean {
  return new Set(points.map((point) => `${point.x},${point.y}`)).size === points.length;
}

function hasNonCollinearTriple(points: ReadonlyArray<CameraPoint>): boolean {
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      for (let c = b + 1; c < points.length; c++) {
        const first = points[a];
        const second = points[b];
        const third = points[c];
        if (first === undefined || second === undefined || third === undefined) continue;
        if (Math.abs(signedDoubleArea(first, second, third)) > EPSILON) return true;
      }
    }
  }
  return false;
}

function hasStablePointSpread(points: ReadonlyArray<CameraPoint>): boolean {
  const scale = maxDistanceSquared(points);
  if (scale < EPSILON) return false;
  let maxArea = 0;
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      for (let c = b + 1; c < points.length; c++) {
        const first = points[a];
        const second = points[b];
        const third = points[c];
        if (first === undefined || second === undefined || third === undefined) continue;
        maxArea = Math.max(maxArea, Math.abs(signedDoubleArea(first, second, third)));
      }
    }
  }
  return maxArea / scale >= MIN_NORMALIZED_TRIANGLE_AREA;
}

function maxDistanceSquared(points: ReadonlyArray<CameraPoint>): number {
  let max = 0;
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      const first = points[a];
      const second = points[b];
      if (first === undefined || second === undefined) continue;
      max = Math.max(max, pointDistanceSquared(first, second));
    }
  }
  return max;
}

function pointDistance(a: CameraPoint, b: CameraPoint): number {
  return Math.sqrt(pointDistanceSquared(a, b));
}

function pointDistanceSquared(a: CameraPoint, b: CameraPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

function signedDoubleArea(a: CameraPoint, b: CameraPoint, c: CameraPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function isPoint(value: unknown): value is CameraPoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point['x'] === 'number' &&
    Number.isFinite(point['x']) &&
    typeof point['y'] === 'number' &&
    Number.isFinite(point['y'])
  );
}
