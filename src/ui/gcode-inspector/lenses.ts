// Data lenses (ADR-255 stage 9): recolour the toolpath by what you want to
// read off it — move kind, cut depth, feed rate, laser power, or whether the
// planner ever reached the programmed feed.
//
// A lens is a pure segment→colour function plus a legend description. The
// scene recolours an existing colour attribute from it, so switching lenses
// never rebuilds geometry (§11 R2).

import type { ProgramTimeModel } from '../../core/gcode-time';
import { SEG_KIND, type GcodeRenderModel } from '../../core/gcode-view';
import { cssHexColor, rgbTriple, type Viewer3dTheme } from '../viewer3d';

export const LENS_IDS = ['kind', 'depth', 'feed', 'power', 'planner'] as const;
export type LensId = (typeof LENS_IDS)[number];

export type Rgb = readonly [number, number, number];

export const LENS_LABEL: Readonly<Record<LensId, string>> = {
  kind: 'Move kind',
  depth: 'Depth (Z)',
  feed: 'Feed rate',
  power: 'Power (S)',
  planner: 'Reached feed',
};

export type LegendSwatch = {
  readonly label: string;
  readonly color: string;
  readonly count: number;
};

export type LensLegend =
  | { readonly kind: 'swatches'; readonly entries: ReadonlyArray<LegendSwatch> }
  | { readonly kind: 'ramp'; readonly from: string; readonly to: string; readonly note: string }
  | { readonly kind: 'note'; readonly note: string };

// Cool → warm. Deliberately not red-green: red already means traversal here,
// and a red/green ramp is unreadable with the commonest colour-vision
// deficiency.
const RAMP_LOW: Rgb = [0.24, 0.42, 0.85];
const RAMP_HIGH: Rgb = [0.98, 0.76, 0.19];
const REACHED_RGB: Rgb = [0.35, 0.72, 0.45];
const LIMITED_RGB: Rgb = [0.9, 0.5, 0.2];

type Range = { readonly min: number; readonly max: number };

/** Colour function in RENDER-MODEL segment index space. The scene maps its
 * own buffer order through this, so callers never deal with bucket order. */
export function lensColorFn(
  model: GcodeRenderModel,
  time: ProgramTimeModel,
  lens: LensId,
  theme: Viewer3dTheme,
): (segmentIndex: number) => Rgb {
  if (lens === 'kind') return kindColorFn(model, theme);
  if (lens === 'planner') {
    return (index) => (time.segFeedLimited[index] === 1 ? LIMITED_RGB : REACHED_RGB);
  }
  const values = lensValues(model, lens);
  const range = spanOf(values);
  return (index) => rampColor(normalized(values[index] ?? 0, range));
}

export function lensLegend(
  model: GcodeRenderModel,
  time: ProgramTimeModel,
  lens: LensId,
  theme: Viewer3dTheme,
): LensLegend {
  if (lens === 'kind') return { kind: 'swatches', entries: kindSwatches(model, theme) };
  if (lens === 'planner') return { kind: 'swatches', entries: plannerSwatches(model, time) };
  const range = spanOf(lensValues(model, lens));
  if (range === null) return { kind: 'note', note: `No ${LENS_LABEL[lens].toLowerCase()} data` };
  return {
    kind: 'ramp',
    from: formatValue(range.min, lens),
    to: formatValue(range.max, lens),
    note: LENS_LABEL[lens],
  };
}

function kindColorFn(model: GcodeRenderModel, theme: Viewer3dTheme): (segmentIndex: number) => Rgb {
  const byKind = new Map<number, Rgb>([
    [SEG_KIND.cut, rgbTriple(theme.cut)],
    [SEG_KIND.plunge, rgbTriple(theme.plunge)],
    [SEG_KIND.retract, rgbTriple(theme.retract)],
    [SEG_KIND.travel, rgbTriple(theme.travel)],
  ]);
  const fallback = rgbTriple(theme.cut);
  return (index) => byKind.get(model.segKind[index] ?? SEG_KIND.cut) ?? fallback;
}

function lensValues(model: GcodeRenderModel, lens: LensId): Float32Array {
  if (lens === 'feed') return model.segFeed;
  if (lens === 'power') return model.segPower;
  return depthValues(model);
}

// Depth reads the deeper of the move's two ends, so a plunge colours by where
// it ends up rather than where it started.
function depthValues(model: GcodeRenderModel): Float32Array {
  const values = new Float32Array(model.segmentCount);
  for (let index = 0; index < model.segmentCount; index += 1) {
    const base = index * 6;
    values[index] = Math.min(model.positions[base + 2] ?? 0, model.positions[base + 5] ?? 0);
  }
  return values;
}

function spanOf(values: Float32Array): Range | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return min > max ? null : { min, max };
}

function normalized(value: number, range: Range | null): number {
  if (range === null || range.max - range.min <= 0) return 0.5;
  return Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min)));
}

function rampColor(t: number): Rgb {
  const mix = (low: number, high: number): number => low + (high - low) * t;
  return [
    mix(RAMP_LOW[0], RAMP_HIGH[0]),
    mix(RAMP_LOW[1], RAMP_HIGH[1]),
    mix(RAMP_LOW[2], RAMP_HIGH[2]),
  ];
}

function kindSwatches(model: GcodeRenderModel, theme: Viewer3dTheme): ReadonlyArray<LegendSwatch> {
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

function plannerSwatches(
  model: GcodeRenderModel,
  time: ProgramTimeModel,
): ReadonlyArray<LegendSwatch> {
  let limited = 0;
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (time.segFeedLimited[index] === 1) limited += 1;
  }
  return [
    { label: 'Reached feed', color: rgbCss(REACHED_RGB), count: model.segmentCount - limited },
    { label: 'Below set feed', color: rgbCss(LIMITED_RGB), count: limited },
  ];
}

export function rgbCss(rgb: Rgb): string {
  const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);
  return `rgb(${channel(rgb[0])}, ${channel(rgb[1])}, ${channel(rgb[2])})`;
}

export function rampCss(): { readonly from: string; readonly to: string } {
  return { from: rgbCss(RAMP_LOW), to: rgbCss(RAMP_HIGH) };
}

function formatValue(value: number, lens: LensId): string {
  if (lens === 'depth') return `${value.toFixed(2)} mm`;
  if (lens === 'feed') return `${Math.round(value)} mm/min`;
  return `${Math.round(value)}`;
}
