// How many automatic Line tabs a closed shape gets (ADR-385).
//
// 'per-shape' (the default, and every operation saved before spacing
// existed) is the historical rule: tabsPerShape on every eligible shape.
// 'spacing' sizes the count to the shape, like LightBurn's Even Spacing
// ("at least one tab at the very start of the path and then again at the
// distance interval",
// https://docs.lightburnsoftware.com/latest/Reference/AddTabs/), clamped to
// a per-shape minimum and maximum. LightBurn leaves whatever is left over as
// a short last gap; here the count is the smallest that keeps every bridge
// within the spacing, then spread evenly, so no run of cut is longer than the
// spacing and none is stubbed short. Positions keep the per-shape rule's half
// step offset, so a tab never lands on the start point.

export type TabCountSettings = {
  readonly tabsPerShape: number;
  readonly tabPlacement?: 'per-shape' | 'spacing' | undefined;
  readonly tabSpacingMm?: number | undefined;
  readonly tabMinPerShape?: number | undefined;
  readonly tabMaxPerShape?: number | undefined;
};

export const DEFAULT_TAB_SPACING_MM = 50;
export const DEFAULT_TAB_MIN_PER_SHAPE = 1;
export const DEFAULT_TAB_MAX_PER_SHAPE = 100;

// Perimeters that are an exact multiple of the spacing must not gain a tab
// from floating-point noise in the perimeter sum.
const RATIO_EPS = 1e-9;

/** Tab count as a function of a shape's perimeter in mm. */
export function tabCountRule(settings: TabCountSettings): (perimeterMm: number) => number {
  if (settings.tabPlacement !== 'spacing') {
    const count = Math.max(1, Math.floor(settings.tabsPerShape));
    return () => count;
  }
  const spacing =
    settings.tabSpacingMm !== undefined &&
    Number.isFinite(settings.tabSpacingMm) &&
    settings.tabSpacingMm > 0
      ? settings.tabSpacingMm
      : DEFAULT_TAB_SPACING_MM;
  const minimum = countOr(settings.tabMinPerShape, DEFAULT_TAB_MIN_PER_SHAPE);
  const maximum = Math.max(minimum, countOr(settings.tabMaxPerShape, DEFAULT_TAB_MAX_PER_SHAPE));
  return (perimeterMm) => {
    const needed = Math.ceil(perimeterMm / spacing - RATIO_EPS);
    return Math.min(maximum, Math.max(minimum, needed));
  };
}

function countOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}
