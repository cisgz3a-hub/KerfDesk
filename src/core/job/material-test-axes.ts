// ADR-497: the settings a Material Test grid can vary along its rows and
// columns, and the values each row or column burns. Every axis runs from its
// lowest-risk value to its highest, so the first cell burned is the gentlest:
// fastest speed, lowest power, fewest passes, widest hatch spacing.

import { LAYER_DEFAULTS } from '../scene';
import { formatCalibrationNumber } from './calibration-labels';

export type MaterialTestParameter = 'speed' | 'power' | 'passes' | 'interval';

export const MATERIAL_TEST_PARAMETERS: ReadonlyArray<MaterialTestParameter> = [
  'speed',
  'power',
  'passes',
  'interval',
];

export const MIN_TEST_PASSES = 1;
export const MAX_TEST_PASSES = 20;
export const MIN_TEST_INTERVAL_MM = 0.01;
export const MAX_TEST_INTERVAL_MM = 10;
const MIN_POWER_PERCENT = 0;
const MAX_POWER_PERCENT = 100;
const MIN_SPEED_MM_MIN = 1;

/** The ranges and fixed values a grid reads, as `MaterialTestGridOptions` holds them. */
export type MaterialTestParameterInput = {
  readonly speedMin: number;
  readonly speedMax: number;
  readonly powerMin: number;
  readonly powerMax: number;
  readonly passesMin?: number;
  readonly passesMax?: number;
  readonly intervalMinMm?: number;
  readonly intervalMaxMm?: number;
  /** Values for the settings the grid does not vary. */
  readonly speed?: number;
  readonly power?: number;
  readonly passes?: number;
  readonly intervalMm?: number;
  /** Active profile compile ceiling. Omit only for profile-agnostic callers. */
  readonly maxFeedMmPerMin?: number;
};

export type MaterialTestAxis = {
  readonly parameter: MaterialTestParameter;
  /** Values as requested, lowest risk first. */
  readonly values: ReadonlyArray<number>;
  /** Values the job runs: speeds capped at the profile's maximum feed. */
  readonly effectiveValues: ReadonlyArray<number>;
  readonly labels: ReadonlyArray<string>;
};

/** One axis of `count` values, or fewer for passes when the range holds fewer whole numbers. */
export function materialTestAxis(
  parameter: MaterialTestParameter,
  count: number,
  input: MaterialTestParameterInput,
): MaterialTestAxis {
  const values = axisValues(parameter, count, input);
  const effectiveValues =
    parameter === 'speed'
      ? values.map((speed) => effectiveCalibrationSpeed(speed, input.maxFeedMmPerMin))
      : values;
  return {
    parameter,
    values,
    effectiveValues,
    labels: effectiveValues.map((value) => materialTestValueLabel(parameter, value)),
  };
}

/** The value a setting keeps when no axis varies it. */
export function fixedMaterialTestValue(
  parameter: MaterialTestParameter,
  input: MaterialTestParameterInput,
): number {
  switch (parameter) {
    case 'speed':
      return clampSpeed(input.speed ?? input.speedMax);
    case 'power':
      return clampPower(input.power ?? input.powerMax);
    case 'passes':
      return clampPasses(input.passes ?? MIN_TEST_PASSES);
    case 'interval':
      return clampInterval(input.intervalMm ?? LAYER_DEFAULTS.hatchSpacingMm);
  }
}

/** Burned label text: speeds show the feed the job runs. */
export function materialTestValueLabel(parameter: MaterialTestParameter, value: number): string {
  if (parameter !== 'interval') return formatCalibrationNumber(value);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function effectiveCalibrationSpeed(
  requested: number,
  maxFeedMmPerMin: number | undefined,
): number {
  return maxFeedMmPerMin !== undefined && Number.isFinite(maxFeedMmPerMin) && maxFeedMmPerMin > 0
    ? Math.min(requested, maxFeedMmPerMin)
    : requested;
}

function axisValues(
  parameter: MaterialTestParameter,
  count: number,
  input: MaterialTestParameterInput,
): number[] {
  switch (parameter) {
    case 'speed': {
      const [low, high] = orderedPair(clampSpeed(input.speedMin), clampSpeed(input.speedMax));
      return linspace(high, low, count);
    }
    case 'power': {
      const [low, high] = orderedPair(clampPower(input.powerMin), clampPower(input.powerMax));
      return linspace(low, high, count);
    }
    case 'passes': {
      const [low, high] = orderedPair(
        clampPasses(input.passesMin ?? MIN_TEST_PASSES),
        clampPasses(input.passesMax ?? input.passesMin ?? MIN_TEST_PASSES),
      );
      // A step of at least one pass keeps every rounded value distinct.
      return linspace(low, high, Math.min(count, high - low + 1)).map(Math.round);
    }
    case 'interval': {
      const fallback = LAYER_DEFAULTS.hatchSpacingMm;
      const [low, high] = orderedPair(
        clampInterval(input.intervalMinMm ?? fallback),
        clampInterval(input.intervalMaxMm ?? input.intervalMinMm ?? fallback),
      );
      return linspace(high, low, count);
    }
  }
}

function linspace(start: number, end: number, count: number): number[] {
  if (count === 1) return [start];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => start + step * index);
}

function orderedPair(a: number, b: number): readonly [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function clampSpeed(value: number): number {
  return Math.max(MIN_SPEED_MM_MIN, finiteOr(value, MIN_SPEED_MM_MIN));
}

function clampPower(value: number): number {
  return Math.max(MIN_POWER_PERCENT, Math.min(MAX_POWER_PERCENT, finiteOr(value, 0)));
}

function clampPasses(value: number): number {
  return Math.max(MIN_TEST_PASSES, Math.min(MAX_TEST_PASSES, Math.round(finiteOr(value, 1))));
}

function clampInterval(value: number): number {
  return Math.max(
    MIN_TEST_INTERVAL_MM,
    Math.min(MAX_TEST_INTERVAL_MM, finiteOr(value, LAYER_DEFAULTS.hatchSpacingMm)),
  );
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
