import type { Polyline } from '../scene';

export type InlayBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export function inlayBounds(contours: ReadonlyArray<Polyline>): InlayBounds | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const contour of contours) {
    for (const point of contour.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return Number.isFinite(minX + minY + maxX + maxY) ? { minX, minY, maxX, maxY } : null;
}

export function inlayBorder(bounds: InlayBounds, borderMm: number): Polyline {
  return {
    closed: true,
    points: [
      { x: bounds.minX - borderMm, y: bounds.minY - borderMm },
      { x: bounds.maxX + borderMm, y: bounds.minY - borderMm },
      { x: bounds.maxX + borderMm, y: bounds.maxY + borderMm },
      { x: bounds.minX - borderMm, y: bounds.maxY + borderMm },
    ],
  };
}

export function mirrorInlayContours(
  contours: ReadonlyArray<Polyline>,
  femaleBounds: InlayBounds,
  plugBounds: InlayBounds,
  spacingMm: number,
  directionX: 1 | -1,
): ReadonlyArray<Polyline> {
  const mirrorSumX = plugBounds.minX + plugBounds.maxX;
  const shiftX =
    directionX === 1
      ? femaleBounds.maxX + spacingMm - plugBounds.minX
      : femaleBounds.minX - spacingMm - plugBounds.maxX;
  return contours.map((contour) => ({
    ...contour,
    points: contour.points.map((point) => ({
      x: mirrorSumX - point.x + shiftX,
      y: point.y,
    })),
  }));
}

export function inlayFilledArea(contours: ReadonlyArray<Polyline>): number {
  let area = 0;
  for (const contour of contours) {
    const points = contour.points;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index],
        b = points[(index + 1) % points.length];
      if (a !== undefined && b !== undefined) area += a.x * b.y - b.x * a.y;
    }
  }
  return Math.abs(area / 2);
}
