// Effective values of the ADR-415 operation settings. Each is optional on the
// operation; these resolvers turn "absent" into the behaviour KerfDesk had
// before the setting existed, so an untouched operation compiles unchanged.

import type { PerforationPattern } from '../geometry/perforation';
import type { LayerOperationSettings } from '../scene';
import { DEFAULT_OVERSCAN_MM, MAX_FILL_OVERSCAN_MM } from './compile-job-defaults';

export const DEFAULT_PERFORATION_CUT_MM = 3;
export const DEFAULT_PERFORATION_SKIP_MM = 1;
// Image overscan uses the same ceiling as Scan Line fill (ADR-238 Amendment 3).
export const MAX_IMAGE_OVERSCAN_MM = MAX_FILL_OVERSCAN_MM;

type CutExtras = Pick<
  LayerOperationSettings,
  'perforationEnabled' | 'perforationCutMm' | 'perforationSkipMm' | 'overcutMm' | 'imageOverscanMm'
>;

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

/** Distance the head needs to reach `feedMmPerMin` from rest: v² / 2a. */
export function accelerationDistanceMm(feedMmPerMin: number, accelMmPerSec2: number): number {
  if (!isPositive(feedMmPerMin) || !isPositive(accelMmPerSec2)) return 0;
  const speedMmPerSec = feedMmPerMin / 60;
  return (speedMmPerSec * speedMmPerSec) / (2 * accelMmPerSec2);
}

function isPositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}
