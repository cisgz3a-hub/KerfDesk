/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import {
  type AABB,
  type Point,
  emptyAABB,
  expandAABB,
  mergeAABB,
} from '../types';

export type ContourRole = 'outer' | 'hole' | 'island' | 'open';
export type ContourWinding = 'cw' | 'ccw';
export type CompoundFillRule = 'nonzero' | 'evenodd';

export interface Contour {
  readonly points: readonly Point[];
  readonly closed: boolean;
  readonly role: ContourRole;
  readonly winding: ContourWinding;
}

export interface CompoundPath {
  readonly sourceObjectId: string;
  readonly contours: readonly Contour[];
  readonly fillRule: CompoundFillRule;
  readonly bounds: AABB;
}

export interface CompoundContourPath {
  readonly points: readonly Point[];
  readonly closed: boolean;
  readonly sourceObjectId: string;
  readonly contourRole: ContourRole;
  readonly winding: ContourWinding;
}

export interface CompoundPathInput {
  readonly sourceObjectId: string;
  readonly contours: readonly Contour[];
  readonly fillRule?: CompoundFillRule;
}

export function contourArea(contour: Pick<Contour, 'points'>): number {
  const points = contour.points;
  if (points.length < 3) return 0;

  let doubleArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    doubleArea += a.x * b.y - b.x * a.y;
  }
  return doubleArea / 2;
}

export function contourWinding(points: readonly Point[]): ContourWinding {
  return contourArea({ points }) < 0 ? 'cw' : 'ccw';
}

export function contourBounds(contour: Pick<Contour, 'points'>): AABB {
  let bounds = emptyAABB();
  for (const point of contour.points) {
    bounds = expandAABB(bounds, point.x, point.y);
  }
  return bounds;
}

export function makeContour(
  points: readonly Point[],
  closed: boolean,
  role: ContourRole = closed ? 'outer' : 'open',
): Contour {
  if (!closed && role !== 'open') {
    throw new Error('T2-15: open contour must use role "open"');
  }
  if (closed && role === 'open') {
    throw new Error('T2-15: closed contour cannot use role "open"');
  }

  return {
    points: points.map(point => ({ x: point.x, y: point.y })),
    closed,
    role,
    winding: contourWinding(points),
  };
}

export function compoundPathFromContours(input: CompoundPathInput): CompoundPath {
  let bounds = emptyAABB();
  for (const contour of input.contours) {
    bounds = mergeAABB(bounds, contourBounds(contour));
  }

  return {
    sourceObjectId: input.sourceObjectId,
    contours: input.contours.map(contour => ({
      ...contour,
      points: contour.points.map(point => ({ x: point.x, y: point.y })),
    })),
    fillRule: input.fillRule ?? 'nonzero',
    bounds,
  };
}

export function flattenCompoundPathToContours(path: CompoundPath): CompoundContourPath[] {
  return path.contours.map(contour => ({
    points: contour.points.map(point => ({ x: point.x, y: point.y })),
    closed: contour.closed,
    sourceObjectId: path.sourceObjectId,
    contourRole: contour.role,
    winding: contour.winding,
  }));
}

