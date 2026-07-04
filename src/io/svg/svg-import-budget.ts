export const SVG_IMPORT_LIMITS = {
  coloredPaths: 256,
  polylines: 50_000,
  points: 250_000,
  coordinateMagnitudeMm: 1_000_000,
} as const;

export type SvgImportBudget = {
  readonly colors: Set<string>;
  polylines: number;
  points: number;
};

type SvgPoint = {
  readonly x: number;
  readonly y: number;
};

export function createSvgImportBudget(): SvgImportBudget {
  return { colors: new Set(), polylines: 0, points: 0 };
}

export function reserveSvgPolyline(
  color: string,
  pointCount: number,
  budget: SvgImportBudget,
): void {
  if (!budget.colors.has(color) && budget.colors.size + 1 > SVG_IMPORT_LIMITS.coloredPaths) {
    throw new Error(`SVG import exceeds ${SVG_IMPORT_LIMITS.coloredPaths} color group(s)`);
  }
  if (budget.polylines + 1 > SVG_IMPORT_LIMITS.polylines) {
    throw new Error(`SVG import exceeds ${SVG_IMPORT_LIMITS.polylines} polyline(s)`);
  }
  if (budget.points + pointCount > SVG_IMPORT_LIMITS.points) {
    throw new Error(`SVG import exceeds ${SVG_IMPORT_LIMITS.points} point(s)`);
  }
  budget.colors.add(color);
  budget.polylines += 1;
  budget.points += pointCount;
}

export function assertSvgImportPoints(points: ReadonlyArray<SvgPoint>): void {
  for (const point of points) {
    if (!isSvgImportCoordinate(point.x) || !isSvgImportCoordinate(point.y)) {
      throw new Error('SVG import contains unsupported non-finite or extreme coordinates');
    }
  }
}

function isSvgImportCoordinate(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= SVG_IMPORT_LIMITS.coordinateMagnitudeMm;
}
