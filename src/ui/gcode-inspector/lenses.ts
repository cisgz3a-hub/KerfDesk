// Data lenses (ADR-255 stage 9): recolour the toolpath by what you want to
// read off it — move kind, cut depth, feed rate, laser power, or whether the
// planner ever reached the programmed feed.
//
// A lens is a pure segment→colour function plus a legend description. The
// scene recolours an existing colour attribute from it, so switching lenses
// never rebuilds geometry (§11 R2).

import type { ProgramTimeModel } from '../../core/gcode-time';
import { SEG_KIND, type GcodeRenderModel } from '../../core/gcode-view';
import type { Viewer3dTheme } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dLook } from '../viewer3d/viewer3d-look';
import { buildDepthLensScale, type Rgb } from './depth-lens';
import { lensPalette, rampAt, rampCss, toolColor, type LensPalette } from './lens-palette';
import type { ToolSections } from './tool-sections';

/** Stable lens identifiers in the order presented by both viewer controls. */
export const LENS_IDS = ['depth', 'tool', 'kind', 'feed', 'power', 'planner'] as const;
/** A supported semantic colour mode for G-code 3D segments. */
export type LensId = (typeof LENS_IDS)[number];

/** Initial colour mode for a G-code 3D view whose program says nothing else. */
export const DEFAULT_LENS_ID: LensId = 'depth';

// Below this spread every cut sits on one plane (a laser job, a single-depth
// engrave), so Depth / pass would paint the whole program one colour.
const FLAT_DEPTH_SPAN_MM = 0.001;

/**
 * The lens a newly opened program starts on (ADR-425). A non-CNC program that
 * cuts on one plane with varying S is a raster photo or a multi-power job:
 * Depth would show it as a single-colour block, so it opens on Power. CNC
 * programs and everything else open on Depth / pass. The operator's own pick
 * always wins over this.
 */
export function defaultLensFor(model: GcodeRenderModel, machineKind?: 'laser' | 'cnc'): LensId {
  if (machineKind === 'cnc') return DEFAULT_LENS_ID;
  const scale = buildDepthLensScale(model);
  const flat = scale === null || scale.shallowMm - scale.deepMm < FLAT_DEPTH_SPAN_MM;
  return flat && cutPowerVaries(model) ? 'power' : DEFAULT_LENS_ID;
}

function cutPowerVaries(model: GcodeRenderModel): boolean {
  let first: number | null = null;
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (model.segKind[index] === SEG_KIND.travel) continue;
    const power = model.segPower[index];
    if (power === undefined || !Number.isFinite(power)) continue;
    if (first === null) first = power;
    else if (power !== first) return true;
  }
  return false;
}

export const LENS_LABEL: Readonly<Record<LensId, string>> = {
  kind: 'Move kind',
  depth: 'Depth / pass',
  tool: 'Tool',
  feed: 'Feed rate',
  power: 'Power (S)',
  planner: 'Reached feed',
};

// Legend colours describe what the lines SHOW. Solid moves are vertex-coloured
// fat lines, which render lighter than their theme hex (ADR-425), so their
// swatches go through renderedLineCss. Traversal is a thin colour-managed
// line that renders its hex exactly.
export type LegendSwatch = {
  readonly label: string;
  readonly color: string;
  readonly count: number;
};

export type LensLegend =
  | { readonly kind: 'swatches'; readonly entries: ReadonlyArray<LegendSwatch> }
  | {
      readonly kind: 'ramp';
      readonly from: string;
      readonly to: string;
      readonly note: string;
      /** CSS colours left to right, as the lines render them. */
      readonly stops: ReadonlyArray<string>;
    }
  | { readonly kind: 'note'; readonly note: string };

/** Which look to colour for, and the program's tool sections for the Tool lens. */
export type LensOptions = {
  readonly look?: Viewer3dLook | undefined;
  readonly sections?: ToolSections | null | undefined;
};

type Range = { readonly min: number; readonly max: number };

/** Colour function in RENDER-MODEL segment index space. The scene maps its
 * own buffer order through this, so callers never deal with bucket order. */
export function lensColorFn(
  model: GcodeRenderModel,
  time: ProgramTimeModel,
  lens: LensId,
  theme: Viewer3dTheme,
  options: LensOptions = {},
): (segmentIndex: number) => Rgb {
  const palette = lensPalette(theme, options.look);
  const travel = palette.travel;
  const isTravel = (index: number): boolean => model.segKind[index] === SEG_KIND.travel;
  if (lens === 'kind') return kindColorFn(model, palette);
  if (lens === 'tool') return toolColorFn(model, palette, options.sections ?? null);
  if (lens === 'depth') {
    const scale = buildDepthLensScale(model);
    if (scale === null) return (index) => (isTravel(index) ? travel : palette.cut);
    return (index) =>
      isTravel(index) ? travel : rampAt(palette.depthRamp, scale.progressOf(index));
  }
  if (lens === 'planner') {
    return (index) => (time.segFeedLimited[index] === 1 ? palette.limited : palette.reached);
  }
  const values = lensValues(model, lens);
  const range = spanOf(values);
  return (index) => rampAt(palette.valueRamp, normalized(values[index] ?? 0, range));
}

export function lensLegend(
  model: GcodeRenderModel,
  time: ProgramTimeModel,
  lens: LensId,
  theme: Viewer3dTheme,
  options: LensOptions = {},
): LensLegend {
  const palette = lensPalette(theme, options.look);
  if (lens === 'kind') return { kind: 'swatches', entries: kindSwatches(model, palette) };
  if (lens === 'tool') {
    return { kind: 'swatches', entries: toolSwatches(model, palette, options.sections ?? null) };
  }
  if (lens === 'depth') return depthLegend(model, palette);
  if (lens === 'planner')
    return { kind: 'swatches', entries: plannerSwatches(model, time, palette) };
  const range = spanOf(lensValues(model, lens));
  if (range === null) return { kind: 'note', note: `No ${LENS_LABEL[lens].toLowerCase()} data` };
  return {
    kind: 'ramp',
    from: formatValue(range.min, lens),
    to: formatValue(range.max, lens),
    note: LENS_LABEL[lens],
    stops: rampCss(palette, palette.valueRamp),
  };
}

function kindColorFn(model: GcodeRenderModel, palette: LensPalette): (segmentIndex: number) => Rgb {
  const byKind = new Map<number, Rgb>([
    [SEG_KIND.cut, palette.cut],
    [SEG_KIND.plunge, palette.plunge],
    [SEG_KIND.retract, palette.retract],
    [SEG_KIND.travel, palette.travel],
  ]);
  return (index) => byKind.get(model.segKind[index] ?? SEG_KIND.cut) ?? palette.cut;
}

// Each tool in its own colour, in order of first use (ADR-426). A program
// that never changes tool shows one colour, as the lens always did.
function toolColorFn(
  model: GcodeRenderModel,
  palette: LensPalette,
  sections: ToolSections | null,
): (segmentIndex: number) => Rgb {
  return (index) => {
    if (model.segKind[index] === SEG_KIND.travel) return palette.travel;
    return toolColor(palette, sections?.segTool[index] ?? 0);
  };
}

function lensValues(model: GcodeRenderModel, lens: 'feed' | 'power'): Float32Array {
  if (lens === 'feed') return model.segFeed;
  return model.segPower;
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

function kindSwatches(model: GcodeRenderModel, palette: LensPalette): ReadonlyArray<LegendSwatch> {
  const counts = new Map<number, number>();
  for (let index = 0; index < model.segmentCount; index += 1) {
    const kind = model.segKind[index] ?? SEG_KIND.travel;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const line = palette.lineCss;
  return [
    { label: 'Cut', color: line(palette.cut), count: counts.get(SEG_KIND.cut) ?? 0 },
    { label: 'Plunge', color: line(palette.plunge), count: counts.get(SEG_KIND.plunge) ?? 0 },
    { label: 'Retract', color: line(palette.retract), count: counts.get(SEG_KIND.retract) ?? 0 },
    { label: 'Traversal', color: palette.travelCss, count: counts.get(SEG_KIND.travel) ?? 0 },
  ];
}

function toolSwatches(
  model: GcodeRenderModel,
  palette: LensPalette,
  sections: ToolSections | null,
): ReadonlyArray<LegendSwatch> {
  let travel = 0;
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (model.segKind[index] === SEG_KIND.travel) travel += 1;
  }
  const tools = sections?.tools ?? [{ label: null, moveCount: model.segmentCount - travel }];
  const entries = tools.map((tool, index) => ({
    label: tool.label ?? 'Toolpath',
    color: palette.lineCss(toolColor(palette, index)),
    count: tool.moveCount,
  }));
  return [...entries, { label: 'Traversal', color: palette.travelCss, count: travel }];
}

function depthLegend(model: GcodeRenderModel, palette: LensPalette): LensLegend {
  const scale = buildDepthLensScale(model);
  if (scale === null) return { kind: 'note', note: 'No cutting depth data' };
  const levelWord = scale.levelCount === 1 ? 'level' : 'levels';
  const colours = palette.look === 'studio' ? 'bright to dark' : 'pale blue to pale red';
  return {
    kind: 'ramp',
    from: `Shallow ${formatDepth(scale.shallowMm)}`,
    to: `Deep ${formatDepth(scale.deepMm)}`,
    note: `${scale.levelCount} depth ${levelWord}, ${colours}`,
    stops: rampCss(palette, palette.depthRamp),
  };
}

function plannerSwatches(
  model: GcodeRenderModel,
  time: ProgramTimeModel,
  palette: LensPalette,
): ReadonlyArray<LegendSwatch> {
  let limited = 0;
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (time.segFeedLimited[index] === 1) limited += 1;
  }
  return [
    {
      label: 'Reached feed',
      color: palette.lineCss(palette.reached),
      count: model.segmentCount - limited,
    },
    { label: 'Below set feed', color: palette.lineCss(palette.limited), count: limited },
  ];
}

export function rgbCss(rgb: Rgb): string {
  const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);
  return `rgb(${channel(rgb[0])}, ${channel(rgb[1])}, ${channel(rgb[2])})`;
}

function formatValue(value: number, lens: 'feed' | 'power'): string {
  if (lens === 'feed') return `${Math.round(value)} mm/min`;
  return `${Math.round(value)}`;
}

function formatDepth(value: number): string {
  return `${value.toFixed(2)} mm`;
}
