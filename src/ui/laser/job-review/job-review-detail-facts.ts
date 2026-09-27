// Pure one-line summaries of everything an operation runs with beyond the
// editable core numbers (ADR-224 v2): the mode-specific laser settings, the
// CNC strategy settings, and the material each operation is bound to. The
// table renders these as a muted detail line under each row.

import { CHIPLOAD_MATERIALS, isProfileCutType, zPassDepths } from '../../../core/cnc';
// Deep import: core/cnc's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import { cutCanFreePart } from '../../../core/cnc/cnc-tabs';
import { findCncMachineStarterById } from '../../../core/cnc/machine-starters';
import {
  imageOverscanMmFor,
  overcutMmFor,
  perforationPatternFor,
} from '../../../core/job/operation-cut-extras';
import { DEFAULT_OVERSCAN_MM, MAX_FILL_OVERSCAN_MM } from '../../../core/job/compile-job-defaults';
import {
  DEFAULT_CNC_STOCK,
  type CncLayerSettings,
  type Layer,
  type LayerOperationSettings,
} from '../../../core/scene';
import type { MaterialLibraryDocument } from '../../../io/material-library';
import { materialBindingStatus } from '../../layers/material-binding-status';
import { formatMm } from './job-review-format';

const FILL_STYLE_LABELS: Readonly<Record<LayerOperationSettings['fillStyle'], string>> = {
  scanline: 'Scanline',
  offset: 'Offset',
  island: 'Island',
};

const SEPARATOR = ' · ';

/** The read-only settings a laser operation runs with, joined for one line. */
export function laserOperationDetail(settings: LayerOperationSettings): string {
  switch (settings.mode) {
    case 'line':
      return lineDetail(settings);
    case 'fill':
      return fillDetail(settings);
    case 'image':
      return imageDetail(settings);
  }
}

function lineDetail(settings: LayerOperationSettings): string {
  return [
    `Kerf ${formatMm(settings.kerfOffsetMm)} mm`,
    `stored contour entry target ${formatMm(settings.fillOverscanMm)} mm`,
    laserTabsPart(settings),
    ...lineCutExtrasParts(settings),
    ...(settings.passThrough ? ['pass-through'] : []),
    `min power ${settings.minPower}%`,
    ...powerModePart(settings),
  ].join(SEPARATOR);
}

function fillDetail(settings: LayerOperationSettings): string {
  return [
    `${FILL_STYLE_LABELS[settings.fillStyle]} fill`,
    `${formatIntervalMm(settings.hatchSpacingMm)} mm hatch at ${settings.hatchAngleDeg}°`,
    settings.fillBidirectional ? 'bidirectional' : 'one-way',
    ...(settings.fillCrossHatch ? ['cross-hatch'] : []),
    `stored overscan ${formatMm(settings.fillOverscanMm)} mm`,
    ...(settings.fillStyle === 'scanline' && settings.fillOverscanMm > MAX_FILL_OVERSCAN_MM
      ? [`applied at most ${MAX_FILL_OVERSCAN_MM} mm`]
      : []),
    ...localScanOffsetPart(settings),
    ...powerModePart(settings),
  ].join(SEPARATOR);
}

function formatIntervalMm(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function imageDetail(settings: LayerOperationSettings): string {
  return [
    `${capitalizeToken(settings.ditherAlgorithm)} dither`,
    `${settings.linesPerMm} lines/mm`,
    settings.imageBidirectional ? 'bidirectional' : 'one-way',
    ...(settings.negativeImage ? ['negative'] : []),
    ...(settings.dotWidthCorrectionMm !== 0
      ? [`dot width ${formatMm(settings.dotWidthCorrectionMm)} mm`]
      : []),
    ...(imageOverscanMmFor(settings) !== DEFAULT_OVERSCAN_MM
      ? [`overscan ${formatMm(imageOverscanMmFor(settings))} mm`]
      : []),
    ...localScanOffsetPart(settings),
  ].join(SEPARATOR);
}

// ADR-415: shown only when set, so operations that never used them read as before.
function lineCutExtrasParts(settings: LayerOperationSettings): ReadonlyArray<string> {
  const perforation = perforationPatternFor(settings);
  const overcutMm = overcutMmFor(settings);
  return [
    ...(perforation === null
      ? []
      : [
          `perforated ${formatMm(perforation.cutMm)} mm cut / ${formatMm(perforation.skipMm)} mm skip`,
        ]),
    ...(overcutMm > 0 ? [`overcut ${formatMm(overcutMm)} mm on final pass`] : []),
  ];
}

function localScanOffsetPart(settings: LayerOperationSettings): ReadonlyArray<string> {
  const offsetMm = settings.bidirectionalScanOffsetMm;
  if (offsetMm === undefined) return [];
  const signed = offsetMm > 0 ? `+${formatIntervalMm(offsetMm)}` : formatIntervalMm(offsetMm);
  return [`local scan offset ${signed} mm — replaces device table only for bidirectional output`];
}

/** Compiled relief stages whose groups record no ramp, so they plunge. */
export type PlungingReliefStage = 'relief-rough' | 'relief-finish';

/** What the compiled job cut for the relief objects of one CNC operation. */
export type CompiledReliefFacts = {
  // Distinct depths the relief roughing cuts at, as emitted, shallowest first.
  readonly roughingLevelDepthsMm: ReadonlyArray<number>;
  // Whether the operation's other shapes compiled groups of their own.
  readonly cutsOtherShapes: boolean;
};

/** The read-only strategy a CNC operation cuts with, joined for one line.
 * `plungingReliefStages` comes from the compiled job (ADR-273 Amendment 1), as
 * does `relief` when the operation cut relief objects (ADR-224 Amendment 3). */
export function cncOperationDetail(
  settings: CncLayerSettings,
  stockThicknessMm?: number,
  plungingReliefStages: ReadonlyArray<PlungingReliefStage> = [],
  relief?: CompiledReliefFacts,
): string {
  // A relief roughs to its own depth, level by level, and takes no tabs. An
  // operation that cut only reliefs cut no shape of its cut type, so that
  // type's depth, tabs and strategy parts would describe nothing.
  const shapes = relief === undefined || relief.cutsOtherShapes;
  // Read the pass count from the same helper the compiler steps with, rather
  // than re-deriving it: zPassDepths carries an epsilon and a per-pass clamp,
  // and a bare Math.ceil disagreed with the emitter on imperial depths
  // (19.05 / 1.5875 floats to 12.000000000000002, showing 13 for 12 passes).
  return [
    ...reliefRoughingPart(relief),
    ...(shapes ? cncDepthParts(settings, relief !== undefined) : []),
    ...cncStepoverPart(settings, shapes, relief),
    ...cncDirectionPart(settings),
    ...(shapes ? cncProfileTabsPart(settings, stockThicknessMm, relief !== undefined) : []),
    ...cncEntryPart(settings, plungingReliefStages),
    ...(shapes ? cncVCarveClearPart(settings) : []),
    ...cncFinishAllowancePart(settings),
    ...(shapes ? cncPocketStrategyPart(settings) : []),
    feedSourcePart(settings),
  ].join(SEPARATOR);
}

// ADR-224 Amendment 3: name the levels the compiled roughing cuts, since a
// relief's depth comes from the relief, not from the operation's Cut depth.
function reliefRoughingPart(relief: CompiledReliefFacts | undefined): ReadonlyArray<string> {
  if (relief === undefined) return [];
  const levels = relief.roughingLevelDepthsMm;
  const deepestMm = levels[levels.length - 1];
  if (deepestMm === undefined) return ['no relief roughing levels'];
  const noun = levels.length === 1 ? 'level' : 'levels';
  return [`relief roughing ${levels.length} ${noun} to ${formatIntervalMm(deepestMm)} mm`];
}

// Relief roughing rings step by the stepover on every cut type, V-carve too.
function cncStepoverPart(
  settings: CncLayerSettings,
  shapes: boolean,
  relief: CompiledReliefFacts | undefined,
): ReadonlyArray<string> {
  const reliefRings = (relief?.roughingLevelDepthsMm.length ?? 0) > 0;
  return reliefRings || (shapes && settings.cutType !== 'v-carve')
    ? [`stepover ${settings.stepoverPercent}%`]
    : [];
}

function cncDirectionPart(settings: CncLayerSettings): ReadonlyArray<string> {
  return settings.cutDirection === undefined || !DIRECTED_CUT_TYPES.has(settings.cutType)
    ? []
    : [settings.cutDirection];
}

function cncProfileTabsPart(
  settings: CncLayerSettings,
  stockThicknessMm: number | undefined,
  besideReliefs: boolean,
): ReadonlyArray<string> {
  // Relief passes take no tabs, so kept tabs belong to the other shapes alone.
  const keptNote = besideReliefs ? ', none on reliefs' : '';
  return isProfileCutType(settings.cutType)
    ? [cncTabsPart(settings, stockThicknessMm, keptNote)]
    : [];
}

function cncVCarveClearPart(settings: CncLayerSettings): ReadonlyArray<string> {
  const active =
    settings.cutType === 'v-carve' &&
    (settings.vCarveFlatDepthEnabled ?? true) &&
    settings.vClearToolId !== undefined;
  return active ? [`clear stepover ${settings.stepoverPercent}%`] : [];
}

function cncFinishAllowancePart(settings: CncLayerSettings): ReadonlyArray<string> {
  const allowance = settings.finishAllowanceMm;
  return allowance !== undefined && allowance > 0
    ? [`finish allowance ${formatMm(allowance)} mm`]
    : [];
}

function cncPocketStrategyPart(settings: CncLayerSettings): ReadonlyArray<string> {
  const strategy = settings.pocketStrategy;
  return strategy !== undefined && strategy !== 'offset' ? [`${strategy} pocket`] : [];
}

function cncDepthParts(settings: CncLayerSettings, besideReliefs: boolean): ReadonlyArray<string> {
  if (settings.cutType === 'v-carve') {
    return (settings.vCarveFlatDepthEnabled ?? true)
      ? [
          `requested flat floor ${formatMm(settings.depthMm)} mm`,
          `max stepdown ${formatMm(settings.depthPerPassMm)} mm`,
        ]
      : ['flowing V-depth', `max stepdown ${formatMm(settings.depthPerPassMm)} mm`];
  }
  const passes = zPassDepths(settings.depthMm, settings.depthPerPassMm).length;
  // Cut depth reaches only the shapes that are not reliefs.
  const where = besideReliefs ? ' on the other shapes' : '';
  return [`${passes} ${passes === 1 ? 'pass' : 'passes'}${where}`];
}

/** Display name for a layer's linked material preset; null = no binding. */
export function boundMaterialLabel(
  binding: Layer['materialBinding'],
  library: MaterialLibraryDocument | null,
): string | null {
  if (binding === undefined) return null;
  if (library === null || library.libraryId !== binding.libraryId) {
    return 'Linked material (library unavailable)';
  }
  const entry = library.entries.find((preset) => preset.id === binding.presetId);
  if (entry === undefined) return 'Linked material (preset missing)';
  const label =
    entry.title ??
    `${entry.materialName}${entry.thicknessMm === undefined ? '' : ` ${formatMm(entry.thicknessMm)} mm`}`;
  const status = materialBindingStatus(binding, library);
  if (status?.kind === 'current') {
    return `${label} — linked current (revision ${entry.revision})`;
  }
  if (status?.kind === 'stale') {
    return `${label} — linked stale (saved ${binding.presetRevision ?? 'untracked'}; current ${entry.revision})`;
  }
  return `${label} — linked revision untracked`;
}

// Cut direction only reaches the toolpath for cut types with a defined material
// side; enforceCutDirection returns null for engrave and profile-on-path, so
// printing the stored word there tells the operator about motion that never
// happens.
const DIRECTED_CUT_TYPES: ReadonlySet<CncLayerSettings['cutType']> = new Set([
  'profile-outside',
  'profile-inside',
  'pocket',
]);

function laserTabsPart(settings: LayerOperationSettings): string {
  if (!settings.tabsEnabled) return 'tabs off';
  return `tabs ${settings.tabsPerShape} × ${formatMm(settings.tabSizeMm)} mm`;
}

function cncTabsPart(
  settings: CncLayerSettings,
  stockThicknessMm: number | undefined,
  keptNote: string,
): string {
  if (!settings.tabsEnabled) return 'tabs off';
  const configured = `tabs ${settings.tabsPerShape} per shape (${formatMm(settings.tabWidthMm)} × ${formatMm(settings.tabHeightMm)} mm)`;
  if (stockThicknessMm === undefined) return `${configured}${keptNote}`;
  // ADR-258 amendment 1: the compiler drops tabs where the floor holds the part,
  // so say so rather than list tabs that will not be cut.
  if (!cutCanFreePart(settings.depthMm, settings.tabHeightMm, stockThicknessMm)) {
    return `${configured}, skipped: the ${formatMm(stockThicknessMm - settings.depthMm)} mm floor holds the part`;
  }
  // Amendment 3: a set stock thickness measures a kept tab from the stock bottom.
  return stockThicknessMm === DEFAULT_CNC_STOCK.thicknessMm
    ? `${configured}${keptNote}`
    : `${configured} above the stock bottom${keptNote}`;
}

function cncEntryPart(
  settings: CncLayerSettings,
  plungingReliefStages: ReadonlyArray<PlungingReliefStage>,
): ReadonlyArray<string> {
  const entry = requestedCncEntry(settings);
  if (entry === null) return [];
  const notes = [...entry.notes, ...reliefPlungeNote(plungingReliefStages)];
  return [notes.length === 0 ? entry.label : `${entry.label} (${notes.join('; ')})`];
}

function requestedCncEntry(
  settings: CncLayerSettings,
): { readonly label: string; readonly notes: ReadonlyArray<string> } | null {
  const rampEntryDeg =
    settings.cutType === 'v-carve' ? settings.vCarveRampEntryDeg : settings.rampEntryDeg;
  if (rampEntryDeg !== undefined) {
    return settings.cutType === 'v-carve'
      ? { label: `requested entry ${rampEntryDeg}°`, notes: ['medial depth profile governs'] }
      : { label: `ramp entry ${rampEntryDeg}°`, notes: [] };
  }
  if (settings.cutType === 'v-carve') return null;
  if (settings.helixEntry !== undefined) return { label: 'helix entry', notes: [] };
  return null;
}

// The layer's entry ramps or circles only its other shapes: a relief group
// that records no ramp plunges at every start (ADR-273 Amendment 1).
function reliefPlungeNote(stages: ReadonlyArray<PlungingReliefStage>): ReadonlyArray<string> {
  if (stages.length === 0) return [];
  if (stages.length > 1) return ['relief passes plunge'];
  return [stages[0] === 'relief-rough' ? 'relief roughing plunges' : 'relief finishing plunges'];
}

function powerModePart(settings: LayerOperationSettings): ReadonlyArray<string> {
  return settings.powerMode === undefined ? [] : [`${settings.powerMode} power`];
}

function feedSourcePart(settings: CncLayerSettings): string {
  const source = settings.feedSource;
  if (source?.kind === 'machine-starter') {
    const starter = findCncMachineStarterById(source.starterId);
    const identity = starter?.label ?? source.starterId;
    if (starter === null) {
      return `Machine starter values: ${identity} (revision ${source.revision}; catalog entry unavailable)`;
    }
    return `Machine starter values: ${identity} (revision ${source.revision}) · ${starter.operatorNotice}`;
  }
  const materialKey =
    source?.kind === 'material-recipe' ? source.materialKey : settings.materialKey;
  const material = CHIPLOAD_MATERIALS.find((entry) => entry.value === materialKey);
  if (material !== undefined && source?.kind === 'material-recipe') {
    return `${material.label} recipe (${source.fluteCount} flutes)`;
  }
  return material === undefined ? 'Manual feeds' : `${material.label} feeds (legacy/unscoped)`;
}

function capitalizeToken(token: string): string {
  return token
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
}
