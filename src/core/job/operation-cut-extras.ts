// Effective values of the ADR-415 and ADR-494 operation settings. Each is
// optional on the operation; these resolvers turn "absent" into the behaviour
// KerfDesk had before the setting existed, so an untouched operation compiles
// unchanged.

import type { PerforationPattern } from '../geometry/perforation';
import type { LayerOperationSettings } from '../scene';
import { DEFAULT_OVERSCAN_MM, MAX_FILL_OVERSCAN_MM } from './compile-job-defaults';

export const DEFAULT_PERFORATION_CUT_MM = 3;
export const DEFAULT_PERFORATION_SKIP_MM = 1;
// Image overscan uses the same ceiling as Scan Line fill (ADR-238 Amendment 3).
export const MAX_IMAGE_OVERSCAN_MM = MAX_FILL_OVERSCAN_MM;
export const DEFAULT_TAB_SPACING_MM = 50;

type CutExtras = Pick<
  LayerOperationSettings,
  'perforationEnabled' | 'perforationCutMm' | 'perforationSkipMm' | 'overcutMm' | 'imageOverscanMm'
>;

type TabSettings = Pick<
  LayerOperationSettings,
  'tabsPerShape' | 'tabLayout' | 'tabSpacingMm' | 'tabMaxPerShape' | 'tabCutPowerPercent'
>;

/** How automatic Line tabs are spread round each closed contour. */
export type AutomaticTabLayout =
  | { readonly kind: 'count'; readonly count: number }
  | { readonly kind: 'spacing'; readonly spacingMm: number; readonly maxPerShape: number };

/** The dash pattern a Line operation cuts, or null when it cuts continuously. */
export function perforationPatternFor(settings: CutExtras): PerforationPattern | null {
  if (settings.perforationEnabled !== true) return null;
  const cutMm = settings.perforationCutMm ?? DEFAULT_PERFORATION_CUT_MM;
  const skipMm = settings.perforationSkipMm ?? DEFAULT_PERFORATION_SKIP_MM;
  return isPositive(cutMm) && isPositive(skipMm) ? { cutMm, skipMm } : null;
}

/** How far a closed Line contour runs past its start on the final pass; 0 is off. */
export function overcutMmFor(settings: CutExtras): number {
  return isPositive(settings.overcutMm) ? settings.overcutMm : 0;
}

/** Laser-off run-up each image scan line gets on both ends. */
export function imageOverscanMmFor(settings: CutExtras): number {
  const value = settings.imageOverscanMm;
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_OVERSCAN_MM;
  return Math.max(0, Math.min(MAX_IMAGE_OVERSCAN_MM, value));
}

/** Count unless the operation chose spacing; a cap of 0 means no cap. */
export function automaticTabLayoutFor(settings: TabSettings): AutomaticTabLayout {
  // Exactly the automatic count tabs-bridges.ts has always used.
  const count = Math.max(1, Math.floor(settings.tabsPerShape));
  if (settings.tabLayout !== 'spacing') return { kind: 'count', count };
  const spacingMm = isPositive(settings.tabSpacingMm)
    ? settings.tabSpacingMm
    : DEFAULT_TAB_SPACING_MM;
  const maxPerShape = Math.max(0, Math.floor(finiteOr(settings.tabMaxPerShape ?? 0, 0)));
  return { kind: 'spacing', spacingMm, maxPerShape };
}

/** Tabs on a contour of this perimeter: one per spacing, at least one, capped. */
export function tabCountForPerimeter(layout: AutomaticTabLayout, perimeterMm: number): number {
  if (layout.kind === 'count') return layout.count;
  const count = Math.max(1, Math.round(perimeterMm / layout.spacingMm));
  return layout.maxPerShape > 0 ? Math.min(count, layout.maxPerShape) : count;
}

/** Share of the cut power the tab spans are burned at; 0 leaves them uncut. */
export function tabCutPowerPercentFor(settings: TabSettings): number {
  const value = settings.tabCutPowerPercent;
  return isPositive(value) ? Math.min(100, value) : 0;
}

/** Distance the head needs to reach `feedMmPerMin` from rest: v² / 2a. */
export function accelerationDistanceMm(feedMmPerMin: number, accelMmPerSec2: number): number {
  if (!isPositive(feedMmPerMin) || !isPositive(accelMmPerSec2)) return 0;
  const speedMmPerSec = feedMmPerMin / 60;
  return (speedMmPerSec * speedMmPerSec) / (2 * accelMmPerSec2);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function isPositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}
