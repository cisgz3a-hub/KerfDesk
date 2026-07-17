// Pure display formatters for the pre-start Job Review dialog (ADR-224).
// No store reads — every function maps a value to operator-facing text.

import type { OverrideValues } from '../../../core/controllers/grbl';
import type { JobBounds, JobOriginPlacement, JobStartMode } from '../../../core/job';
import type { LayerMode } from '../../../core/scene';

const BYTES_PER_KILOBYTE = 1024;
const LARGE_KILOBYTE_THRESHOLD = 100;
const OVERRIDE_BASELINE_PERCENT = 100;

const START_FROM_REVIEW_LABELS: Readonly<Record<JobStartMode, string>> = {
  absolute: 'Absolute coordinates',
  'user-origin': 'User origin',
  'current-position': 'Current position',
  'verified-origin': 'Verified origin',
};

const LAYER_MODE_LABELS: Readonly<Record<LayerMode, string>> = {
  line: 'Line',
  fill: 'Fill',
  image: 'Image',
};

/** Millimetre display: one decimal, trailing zero trimmed. */
export function formatMm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatBoundsSize(bounds: JobBounds): string {
  return `${formatMm(bounds.maxX - bounds.minX)} × ${formatMm(bounds.maxY - bounds.minY)} mm`;
}

export function formatBoundsRange(bounds: JobBounds): string {
  return `X ${formatMm(bounds.minX)} to ${formatMm(bounds.maxX)} · Y ${formatMm(bounds.minY)} to ${formatMm(bounds.maxY)} mm`;
}

export function formatGcodeSize(byteLength: number): string {
  if (byteLength < BYTES_PER_KILOBYTE) return `${byteLength} B`;
  const kilobytes = byteLength / BYTES_PER_KILOBYTE;
  if (kilobytes < BYTES_PER_KILOBYTE) {
    const shown =
      kilobytes >= LARGE_KILOBYTE_THRESHOLD ? Math.round(kilobytes) : Number(kilobytes.toFixed(1));
    return `${shown} KB`;
  }
  return `${Number((kilobytes / BYTES_PER_KILOBYTE).toFixed(2))} MB`;
}

export function formatLayerMode(mode: LayerMode): string {
  return LAYER_MODE_LABELS[mode];
}

/** The origin the shown G-code was actually compiled for (undefined = Absolute). */
export function describeJobOrigin(origin: JobOriginPlacement | undefined): string {
  if (origin === undefined) return 'Absolute coordinates (machine space)';
  const base = `${START_FROM_REVIEW_LABELS[origin.startFrom]} — anchor ${humanizeToken(origin.anchor)}`;
  if (origin.startFrom === 'current-position') {
    return `${base}, head at X ${formatMm(origin.currentPosition.x)} Y ${formatMm(origin.currentPosition.y)}`;
  }
  return base;
}

export function describeOverrides(overrides: OverrideValues | null): string {
  if (overrides === null) return 'Not reported yet';
  return `Feed ${overrides.feed}% · Rapid ${overrides.rapid}% · Spindle ${overrides.spindle}%`;
}

export function overridesAreBaseline(overrides: OverrideValues | null): boolean {
  return (
    overrides === null ||
    (overrides.feed === OVERRIDE_BASELINE_PERCENT &&
      overrides.rapid === OVERRIDE_BASELINE_PERCENT &&
      overrides.spindle === OVERRIDE_BASELINE_PERCENT)
  );
}

export function formatOnOff(value: boolean | undefined): string {
  if (value === undefined) return 'Unknown';
  return value ? 'On' : 'Off';
}

function humanizeToken(token: string): string {
  return token.split('-').join(' ');
}
