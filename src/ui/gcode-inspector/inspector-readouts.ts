// Pure readout formatting for the Inspector panels (ADR-255 stage 4): the
// DRO rows and the program stats rows are derived here so the React
// components stay presentational and the numbers stay unit-testable.
// Legend rendering moved to lenses.ts in stage 9.

import type { ProgramTimeModel } from '../../core/gcode-time';
import type { GcodeRenderModel, ProgramStats } from '../../core/gcode-view';
import type { PlayheadState } from './playhead';

export type Readout = {
  readonly label: string;
  readonly value: string;
};

const EMPTY_DRO: ReadonlyArray<Readout> = [
  { label: 'X', value: '—' },
  { label: 'Y', value: '—' },
  { label: 'Z', value: '—' },
  { label: 'F', value: '—' },
  { label: 'S', value: '—' },
  { label: 'Line', value: '—' },
];

/**
 * Modal machine state at the playhead: the interpolated tool position plus
 * the F / S / source line of the segment being executed. Falls back to the
 * program's final segment when no playhead is supplied.
 */
export function droRows(model: GcodeRenderModel, playhead?: PlayheadState): ReadonlyArray<Readout> {
  const index =
    playhead === undefined || playhead.segmentIndex < 0
      ? model.segmentCount - 1
      : playhead.segmentIndex;
  if (index < 0) return EMPTY_DRO;
  const feed = model.segFeed[index] ?? 0;
  const power = model.segPower[index] ?? 0;
  const point = playhead?.point ?? segmentEndPoint(model, index);
  return [
    { label: 'X', value: `${num(point.x)} mm` },
    { label: 'Y', value: `${num(point.y)} mm` },
    { label: 'Z', value: `${num(point.z)} mm` },
    { label: 'F', value: feed > 0 ? `${Math.round(feed)} mm/min` : '—' },
    { label: 'S', value: power > 0 ? `${num(power)}` : '—' },
    { label: 'Line', value: `${(model.segLine[index] ?? 0) + 1}` },
  ];
}

function segmentEndPoint(
  model: GcodeRenderModel,
  index: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  const base = index * 6;
  return {
    x: model.positions[base + 3] ?? 0,
    y: model.positions[base + 4] ?? 0,
    z: model.positions[base + 5] ?? 0,
  };
}

export function statsRows(
  model: GcodeRenderModel,
  time?: ProgramTimeModel,
): ReadonlyArray<Readout> {
  const { stats } = model;
  return [
    ...(time === undefined ? [] : timeRows(time)),
    { label: 'Size', value: boundsSize(stats) },
    { label: 'Cut', value: `${num(stats.cutMm)} mm` },
    { label: 'Traversal', value: `${num(stats.travelMm)} mm` },
    { label: 'Plunge', value: `${num(stats.plungeMm)} mm` },
    { label: 'Feed range', value: range(stats.feedMinMmPerMin, stats.feedMaxMmPerMin, 'mm/min') },
    { label: 'Power range', value: range(stats.powerMin, stats.powerMax, '') },
    { label: 'Z levels', value: zLevelSummary(stats) },
    { label: 'Segments', value: `${model.segmentCount}` },
    { label: 'Lines', value: `${model.lineCount}` },
  ];
}

// Planner-grade, but against stock GRBL kinematics rather than the connected
// machine's, so it is labelled an estimate rather than a promise.
function timeRows(time: ProgramTimeModel): ReadonlyArray<Readout> {
  const limited = countFeedLimited(time.segFeedLimited);
  const rows: Readout[] = [{ label: 'Est. time', value: `~${clock(time.totalSeconds)}` }];
  if (time.dwellSeconds > 0) {
    rows.push({ label: 'of which dwell', value: clock(time.dwellSeconds) });
  }
  if (limited > 0) {
    rows.push({ label: 'Below set feed', value: `${limited} moves` });
  }
  return rows;
}

function countFeedLimited(flags: Uint8Array): number {
  let count = 0;
  for (const flag of flags) if (flag === 1) count += 1;
  return count;
}

function clock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function boundsSize(stats: ProgramStats): string {
  const bounds = stats.motionBounds;
  if (bounds === null) return '—';
  return `${num(bounds.maxX - bounds.minX)} × ${num(bounds.maxY - bounds.minY)} × ${num(
    bounds.maxZ - bounds.minZ,
  )} mm`;
}

function zLevelSummary(stats: ProgramStats): string {
  if (stats.zLevels.length === 0) return '—';
  const deepest = stats.zLevels[stats.zLevels.length - 1] ?? 0;
  return `${stats.zLevels.length} (deepest ${num(deepest)} mm)`;
}

function range(min: number | null, max: number | null, unit: string): string {
  if (min === null || max === null) return '—';
  const suffix = unit === '' ? '' : ` ${unit}`;
  return min === max ? `${num(min)}${suffix}` : `${num(min)}–${num(max)}${suffix}`;
}

// Fewer decimals as magnitude grows, with trailing zeros trimmed so readouts
// stay scannable: 1234.5 → "1235", 200.0 → "200", -2.00 → "-2".
function num(value: number): string {
  const magnitude = Math.abs(value);
  const digits = magnitude >= 1000 ? 0 : magnitude >= 100 ? 1 : 2;
  const text = value.toFixed(digits);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}
