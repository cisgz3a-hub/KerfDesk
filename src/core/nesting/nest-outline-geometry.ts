import {
  areaD,
  EndType,
  FillRule,
  inflatePathsD,
  intersectD,
  JoinType,
  type PathsD,
} from 'clipper2-ts';
import { nestRotation, type NestPlacement, type NestRect } from './quick-nest';
import type { NestOutline, OutlineNestItem } from './outline-compact-nest';
const AREA_EPSILON = 1e-7;

export type PlacedState = {
  readonly item: OutlineNestItem;
  readonly placement: NestPlacement;
  readonly paths: PathsD;
  readonly bounds: NestRect;
};

export function placedState(
  item: OutlineNestItem,
  placement: NestPlacement,
  padding: number,
): PlacedState {
  const source = validOutline(item.outline)
    ? item.outline
    : rectangleOutline(item.width, item.height);
  const oriented = source.map((path) =>
    path.map((point) => {
      const angle = nestRotation(placement);
      const rotated =
        angle === 90
          ? { x: item.height - point.y, y: point.x }
          : angle === 180
            ? { x: item.width - point.x, y: item.height - point.y }
            : angle === 270
              ? { x: point.y, y: item.width - point.x }
              : point;
      return { x: rotated.x + placement.x, y: rotated.y + placement.y };
    }),
  ) as PathsD;
  const spacing = finiteNonNegative(padding) / 2;
  const paths =
    spacing === 0
      ? oriented
      : inflatePathsD(oriented, spacing, JoinType.Round, EndType.Polygon, 2, 3);
  const bounds = pathsBounds(paths) ?? placementBounds(item, placement, spacing);
  return { item, placement, paths, bounds };
}

export function obstacleState(rect: NestRect, padding: number): PlacedState {
  const item: OutlineNestItem = {
    id: `obstacle:${rect.minX}:${rect.minY}:${rect.maxX}:${rect.maxY}`,
    width: rect.maxX - rect.minX,
    height: rect.maxY - rect.minY,
    canRotate: false,
  };
  return placedState(item, { id: item.id, x: rect.minX, y: rect.minY, rotated90: false }, padding);
}

export function collides(
  candidate: PlacedState,
  others: ReadonlyArray<PlacedState>,
  obstacles: ReadonlyArray<PlacedState>,
): boolean {
  return [...others, ...obstacles].some((other) => {
    if (!rectanglesOverlap(candidate.bounds, other.bounds)) return false;
    const intersection = intersectD(candidate.paths, other.paths, FillRule.NonZero, 3);
    return intersection.some((path) => Math.abs(areaD(path)) > AREA_EPSILON);
  });
}

export function inside(bin: NestRect, bounds: NestRect): boolean {
  return (
    bounds.minX >= bin.minX - 1e-7 &&
    bounds.minY >= bin.minY - 1e-7 &&
    bounds.maxX <= bin.maxX + 1e-7 &&
    bounds.maxY <= bin.maxY + 1e-7
  );
}

export function rectanglesOverlap(left: NestRect, right: NestRect): boolean {
  return (
    left.minX < right.maxX - 1e-7 &&
    left.maxX > right.minX + 1e-7 &&
    left.minY < right.maxY - 1e-7 &&
    left.maxY > right.minY + 1e-7
  );
}

export function pathsBounds(paths: PathsD): NestRect | null {
  const points = paths.flat();
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function placementBounds(
  item: OutlineNestItem,
  placement: NestPlacement,
  padding: number,
): NestRect {
  const width = placement.rotated90 ? item.height : item.width;
  const height = placement.rotated90 ? item.width : item.height;
  return {
    minX: placement.x - padding,
    minY: placement.y - padding,
    maxX: placement.x + width + padding,
    maxY: placement.y + height + padding,
  };
}

export function validOutline(outline: NestOutline | undefined): outline is NestOutline {
  return (
    outline !== undefined &&
    outline.length > 0 &&
    outline.every(
      (path) => path.length >= 3 && path.every((point) => Number.isFinite(point.x + point.y)),
    )
  );
}

export function rectangleOutline(width: number, height: number): NestOutline {
  const safeWidth = finiteNonNegative(width);
  const safeHeight = finiteNonNegative(height);
  return [
    [
      { x: 0, y: 0 },
      { x: safeWidth, y: 0 },
      { x: safeWidth, y: safeHeight },
      { x: 0, y: safeHeight },
    ],
  ];
}

export function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
