// Pure readout formatting for the Inspector panels (ADR-255 stage 4):
// DRO rows, the move-kind legend, and the stats rows are derived here so the
// React components stay presentational and the numbers stay unit-testable.

import { SEG_KIND, type GcodeRenderModel, type ProgramStats } from '../../core/gcode-view';
import { cssHexColor, type Viewer3dTheme } from '../viewer3d';

export type Readout = {
  readonly label: string;
  readonly value: string;
};

export type LegendEntry = {
  readonly label: string;
  readonly color: string;
  readonly count: number;
};

/** Modal machine state at the end of the program (stage 5 makes it follow
 * the playhead; the shape is already playhead-shaped). */
export function droRows(model: GcodeRenderModel): ReadonlyArray<Readout> {
  const last = model.segmentCount - 1;
  if (last < 0) {
    return [
      { label: 'X', value: '—' },
      { label: 'Y', value: '—' },
      { label: 'Z', value: '—' },
      { label: 'F', value: '—' },
      { label: 'S', value: '—' },
      { label: 'Line', value: '—' },
    ];
  }
  const base = last * 6;
  const feed = model.segFeed[last] ?? 0;
  const power = model.segPower[last] ?? 0;
  return [
    { label: 'X', value: `${num(model.positions[base + 3] ?? 0)} mm` },
    { label: 'Y', value: `${num(model.positions[base + 4] ?? 0)} mm` },
    { label: 'Z', value: `${num(model.positions[base + 5] ?? 0)} mm` },
    { label: 'F', value: feed > 0 ? `${Math.round(feed)} mm/min` : '—' },
    { label: 'S', value: power > 0 ? `${num(power)}` : '—' },
    { label: 'Line', value: `${(model.segLine[last] ?? 0) + 1}` },
  ];
}

export function legendEntries(
  model: GcodeRenderModel,
  theme: Viewer3dTheme,
): ReadonlyArray<LegendEntry> {
  const counts = new Map<number, number>();
  for (let index = 0; index < model.segmentCount; index += 1) {
    const kind = model.segKind[index] ?? SEG_KIND.travel;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [
    { label: 'Cut', color: cssHexColor(theme.cut), count: counts.get(SEG_KIND.cut) ?? 0 },
    { label: 'Plunge', color: cssHexColor(theme.plunge), count: counts.get(SEG_KIND.plunge) ?? 0 },
    {
      label: 'Retract',
      color: cssHexColor(theme.retract),
      count: counts.get(SEG_KIND.retract) ?? 0,
    },
    {
      label: 'Traversal',
      color: cssHexColor(theme.travel),
      count: counts.get(SEG_KIND.travel) ?? 0,
    },
  ];
}

export function statsRows(model: GcodeRenderModel): ReadonlyArray<Readout> {
  const { stats } = model;
  return [
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

export function findingsSummary(model: GcodeRenderModel): string | null {
  const parts: string[] = [];
  for (const entry of model.unsupportedWords) {
    parts.push(`${entry.count}× unsupported ${entry.word} (first line ${entry.firstLine + 1})`);
  }
  if (model.skippedMotions.length > 0) {
    const first = model.skippedMotions[0];
    parts.push(
      `${model.skippedMotions.length} skipped move${model.skippedMotions.length === 1 ? '' : 's'}` +
        (first === undefined ? '' : ` — line ${first.line + 1}: ${first.reason}`),
    );
  }
  return parts.length === 0 ? null : parts.join(' · ');
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
