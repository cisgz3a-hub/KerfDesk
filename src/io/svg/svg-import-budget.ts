// Rule 7 / ADR-228 + ADR-268: coloredPaths / polylines / points were REFUSALS
// that threw mid-import ("SVG import exceeds 50000 polyline(s)"), which made a
// large SVG impossible rather than slow. They are policy judgements — every one
// of those loops is bounded by the input, so none of them was a termination
// guarantee — and are now advisory thresholds only.
//
// coordinateMagnitudeMm is different and STAYS a refusal: a non-finite or
// astronomically large coordinate cannot produce meaningful G-code, which is the
// integrity category ADR-243 kept ("NaN coordinates").
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
  budget.colors.add(color);
  budget.polylines += 1;
  budget.points += pointCount;
}

/** Advisory when an import is large enough that the operator should know. */
export function svgImportSizeNote(budget: SvgImportBudget): string | null {
  if (
    budget.colors.size <= SVG_IMPORT_LIMITS.coloredPaths &&
    budget.polylines <= SVG_IMPORT_LIMITS.polylines &&
    budget.points <= SVG_IMPORT_LIMITS.points
  ) {
    return null;
  }
  return (
    `Large SVG: ${budget.polylines.toLocaleString()} polylines, ` +
    `${budget.points.toLocaleString()} points across ${budget.colors.size} color group(s) — ` +
    'editing and output may be slow.'
  );
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
