// Material Test axis model (ADR-381). Each grid axis varies one setting —
// power, speed, line interval or passes — from a start to an end value over a
// count, the choices LightBurn's Material Test offers:
// https://docs.lightburnsoftware.com/2.1/Reference/MaterialTest/
// Every value is clamped to what the machine and the compiler accept, so no
// axis can ask for more than 100 % power or a density the compiler rejects.

import type { DitherAlgorithm } from '../scene';
import { MAX_RASTER_LINES_PER_MM } from '../raster/raster-budget';
import {
  lineIntervalMmToLinesPerMm,
  linesPerMmToLineIntervalMm,
  MIN_RASTER_LINES_PER_MM,
} from '../raster/raster-units';
import { formatCalibrationNumber } from './calibration-labels';

export type MaterialTestParameter = 'power' | 'speed' | 'interval' | 'passes';
export type MaterialTestMode = 'line' | 'fill' | 'image';

export type MaterialTestAxis = {
  readonly parameter: MaterialTestParameter;
  readonly start: number;
  readonly end: number;
  readonly count: number;
};

/** Settings every cell shares unless one of the two axes varies them. */
export type MaterialTestBaseSettings = {
  readonly power: number;
  readonly speed: number;
  readonly passes: number;
  /** Fill line interval or image scan-line interval, mm. */
  readonly intervalMm: number;
  readonly airAssist: boolean;
  readonly ditherAlgorithm: DitherAlgorithm;
};

export type MaterialTestAxisValue = {
  /** Value written into the operation (a feed before the profile ceiling). */
  readonly requested: number;
  /** Value the compiler burns: the ceiling-capped feed, otherwise `requested`. */
  readonly effective: number;
  /** Burned label text. */
  readonly label: string;
};

export const MATERIAL_TEST_MAX_COUNT = 20;
export const MATERIAL_TEST_MAX_PASSES = 100;
const MIN_SPEED_MM_MIN = 1;
// The Cut Settings fill line-interval bounds.
const FILL_INTERVAL_MIN_MM = 0.05;
const FILL_INTERVAL_MAX_MM = 10;
const IMAGE_INTERVAL_MIN_MM = 1 / MAX_RASTER_LINES_PER_MM;
const IMAGE_INTERVAL_MAX_MM = 1 / MIN_RASTER_LINES_PER_MM;

export const MATERIAL_TEST_PARAMETERS: ReadonlyArray<MaterialTestParameter> = [
  'power',
  'speed',
  'interval',
  'passes',
];

export function materialTestParametersForMode(
  mode: MaterialTestMode,
): ReadonlyArray<MaterialTestParameter> {
  return mode === 'line'
    ? MATERIAL_TEST_PARAMETERS.filter((parameter) => parameter !== 'interval')
    : MATERIAL_TEST_PARAMETERS;
}

/** Why a pair of axes cannot make a test, or null when it can. */
export function materialTestAxesIssue(
  rowAxis: Pick<MaterialTestAxis, 'parameter'>,
  columnAxis: Pick<MaterialTestAxis, 'parameter'>,
  mode: MaterialTestMode,
): string | null {
  if (rowAxis.parameter === columnAxis.parameter) {
    return 'Choose a different setting for each axis.';
  }
  const parameters = materialTestParametersForMode(mode);
  if (!parameters.includes(rowAxis.parameter) || !parameters.includes(columnAxis.parameter)) {
    return 'Interval can only be tested in Fill or Image mode.';
  }
  return null;
}

export function materialTestAxisValues(
  axis: MaterialTestAxis,
  mode: MaterialTestMode,
  maxFeedMmPerMin?: number,
): ReadonlyArray<MaterialTestAxisValue> {
  const count = clampMaterialTestCount(axis.count);
  switch (axis.parameter) {
    case 'power':
      return linspace(
        clampMaterialTestPower(axis.start),
        clampMaterialTestPower(axis.end),
        count,
      ).map((value) => plainValue(value, formatCalibrationNumber(value)));
    case 'speed':
      return linspace(
        clampMaterialTestSpeed(axis.start),
        clampMaterialTestSpeed(axis.end),
        count,
      ).map((requested) => speedValue(requested, maxFeedMmPerMin));
    case 'passes':
      return passValues(axis, count);
    case 'interval':
      // Micrometre rounding keeps 0.2 -> 0.05 from storing 0.04999999999999999.
      return linspace(
        clampMaterialTestInterval(axis.start, mode),
        clampMaterialTestInterval(axis.end, mode),
        count,
      ).map((value) => {
        const interval = Number(value.toFixed(6));
        return plainValue(interval, formatMaterialTestInterval(interval));
      });
    default:
      return axis.parameter satisfies never;
  }
}

/**
 * Lowest-risk-first order of an axis's value indices: fastest, weakest, widest
 * interval, fewest passes (ADR-044). LightBurn's list starts from the lowest
 * interval; the widest interval puts the least energy into the material, so it
 * leads here instead.
 */
export function materialTestRiskOrder(
  parameter: MaterialTestParameter,
  values: ReadonlyArray<MaterialTestAxisValue>,
): ReadonlyArray<number> {
  const sign = parameter === 'speed' || parameter === 'interval' ? -1 : 1;
  return values
    .map((value, index) => ({ key: sign * value.requested, index }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.index);
}

/** Largest power an axis reaches: the operation power its cells scale from. */
export function materialTestAxisMaximum(axis: MaterialTestAxis): number {
  return Math.max(clampMaterialTestPower(axis.start), clampMaterialTestPower(axis.end));
}

export function clampMaterialTestCount(value: number): number {
  return clampInteger(value, 1, MATERIAL_TEST_MAX_COUNT);
}

export function clampMaterialTestPower(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

export function clampMaterialTestSpeed(value: number): number {
  return Math.max(MIN_SPEED_MM_MIN, Number.isFinite(value) ? value : MIN_SPEED_MM_MIN);
}

export function clampMaterialTestPasses(value: number): number {
  const rounded = Math.round(Number.isFinite(value) ? value : 1);
  return Math.max(1, Math.min(MATERIAL_TEST_MAX_PASSES, rounded));
}

export function clampMaterialTestInterval(value: number, mode: MaterialTestMode): number {
  const [min, max] =
    mode === 'image'
      ? [IMAGE_INTERVAL_MIN_MM, IMAGE_INTERVAL_MAX_MM]
      : [FILL_INTERVAL_MIN_MM, FILL_INTERVAL_MAX_MM];
  const finite = Number.isFinite(value) ? value : max;
  return Math.max(min, Math.min(max, finite));
}

/** Image density the compiler burns for a requested scan-line interval. */
export function materialTestImageLinesPerMm(intervalMm: number): number {
  return lineIntervalMmToLinesPerMm(intervalMm);
}

/** The scan-line interval an image density actually burns. */
export function materialTestImageIntervalMm(linesPerMm: number): number {
  return linesPerMmToLineIntervalMm(linesPerMm);
}

export function formatMaterialTestInterval(value: number): string {
  return String(Number(value.toFixed(3)));
}

export function effectiveMaterialTestSpeed(
  requested: number,
  maxFeedMmPerMin: number | undefined,
): number {
  return maxFeedMmPerMin !== undefined && Number.isFinite(maxFeedMmPerMin) && maxFeedMmPerMin > 0
    ? Math.min(requested, maxFeedMmPerMin)
    : requested;
}

// Passes are whole numbers, so an axis never holds more steps than distinct
// integers between its ends; rounding would otherwise repeat a pass count.
function passValues(axis: MaterialTestAxis, count: number): ReadonlyArray<MaterialTestAxisValue> {
  const start = clampMaterialTestPasses(axis.start);
  const end = clampMaterialTestPasses(axis.end);
  const steps = Math.min(count, Math.abs(end - start) + 1);
  return linspace(start, end, steps).map((value) => {
    const passes = Math.round(value);
    return plainValue(passes, String(passes));
  });
}

function speedValue(requested: number, maxFeedMmPerMin: number | undefined): MaterialTestAxisValue {
  const effective = effectiveMaterialTestSpeed(requested, maxFeedMmPerMin);
  return { requested, effective, label: formatCalibrationNumber(effective) };
}

function plainValue(value: number, label: string): MaterialTestAxisValue {
  return { requested: value, effective: value, label };
}

function linspace(start: number, end: number, count: number): number[] {
  if (count === 1) return [start];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => start + step * index);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(Number.isFinite(value) ? value : min)));
}
