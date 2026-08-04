import { pointInPolygon } from '../geometry';
import type { Polyline, Vec2 } from '../scene';
import { canonicalAdaptivePocketContours, type AdaptivePocketPlan } from './adaptive-pocket';
import { adaptivePocketContainmentIssue } from './adaptive-pocket-containment';

const MAX_GRID_CELLS = 1_000_000;
const MIN_GRID_MM = 0.05;

export type AdaptivePocketGrid = {
  readonly cellMm: number;
  readonly height: number;
  readonly minX: number;
  readonly minY: number;
  readonly occupied: Uint8Array;
  readonly width: number;
};

type GridResult =
  | { readonly ok: true; readonly grid: AdaptivePocketGrid }
  | { readonly ok: false; readonly reason: string };

export function createAdaptivePocketStockGrid(
  contours: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  plan: Extract<AdaptivePocketPlan, { readonly ok: true }>,
): GridResult {
  const canonicalContours = canonicalAdaptivePocketContours(contours);
  if (canonicalContours === null || canonicalContours.length === 0) {
    return {
      ok: false,
      reason: 'Adaptive verification could not build a canonical pocket region.',
    };
  }
  return createStockGrid(canonicalContours, toolDiameterMm, plan);
}

function createStockGrid(
  contours: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  plan: Extract<AdaptivePocketPlan, { readonly ok: true }>,
): GridResult {
  const bounds = contourBounds(contours);
  if (bounds === null) return { ok: false, reason: 'Adaptive verification has no pocket bounds.' };
  const cellMm = Math.max(MIN_GRID_MM, Math.min(plan.optimalLoadMm / 2, toolDiameterMm / 16, 0.25));
  const width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellMm));
  const height = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cellMm));
  if (width * height > MAX_GRID_CELLS) {
    return {
      ok: false,
      reason: 'Adaptive verification grid is too large; split the pocket into smaller operations.',
    };
  }
  const containmentIssue = adaptivePocketContainmentIssue(contours, toolDiameterMm / 2, plan);
  if (containmentIssue !== null) return { ok: false, reason: containmentIssue };
  const grid: AdaptivePocketGrid = {
    cellMm,
    height,
    minX: bounds.minX,
    minY: bounds.minY,
    occupied: new Uint8Array(width * height),
    width,
  };
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      if (pointInContours(cellCenter(grid, col, row), contours)) {
        grid.occupied[row * width + col] = 1;
      }
    }
  }
  return { ok: true, grid };
}

function cellCenter(grid: AdaptivePocketGrid, col: number, row: number): Vec2 {
  return { x: grid.minX + (col + 0.5) * grid.cellMm, y: grid.minY + (row + 0.5) * grid.cellMm };
}

function contourBounds(
  contours: ReadonlyArray<Polyline>,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const contour of contours) {
    for (const point of contour.points) {
      if (bounds === null) bounds = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
      else {
        bounds.minX = Math.min(bounds.minX, point.x);
        bounds.minY = Math.min(bounds.minY, point.y);
        bounds.maxX = Math.max(bounds.maxX, point.x);
        bounds.maxY = Math.max(bounds.maxY, point.y);
      }
    }
  }
  return bounds;
}

function pointInContours(point: Vec2, contours: ReadonlyArray<Polyline>): boolean {
  let inside = false;
  for (const contour of contours) if (pointInPolygon(point, contour.points)) inside = !inside;
  return inside;
}
