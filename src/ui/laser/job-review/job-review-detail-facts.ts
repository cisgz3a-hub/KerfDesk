// Pure one-line summaries of everything an operation runs with beyond the
// editable core numbers (ADR-224 v2): the mode-specific laser settings, the
// CNC strategy settings, and the material each operation is bound to. The
// table renders these as a muted detail line under each row.

import { CHIPLOAD_MATERIALS, zPassDepths } from '../../../core/cnc';
import { findCncMachineStarterById } from '../../../core/cnc/machine-starters';
import type { CncLayerSettings, Layer, LayerOperationSettings } from '../../../core/scene';
import type { MaterialLibraryDocument } from '../../../io/material-library';
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
    laserTabsPart(settings),
    ...(settings.passThrough ? ['pass-through'] : []),
    `min power ${settings.minPower}%`,
    ...powerModePart(settings),
  ].join(SEPARATOR);
}

function fillDetail(settings: LayerOperationSettings): string {
  return [
    `${FILL_STYLE_LABELS[settings.fillStyle]} fill`,
    `${formatMm(settings.hatchSpacingMm)} mm hatch at ${settings.hatchAngleDeg}°`,
    settings.fillBidirectional ? 'bidirectional' : 'one-way',
    ...(settings.fillCrossHatch ? ['cross-hatch'] : []),
    `stored overscan ${formatMm(settings.fillOverscanMm)} mm`,
    ...powerModePart(settings),
  ].join(SEPARATOR);
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
  ].join(SEPARATOR);
}

/** The read-only strategy a CNC operation cuts with, joined for one line. */
export function cncOperationDetail(settings: CncLayerSettings): string {
  // Read the pass count from the same helper the compiler steps with, rather
  // than re-deriving it: zPassDepths carries an epsilon and a per-pass clamp,
  // and a bare Math.ceil disagreed with the emitter on imperial depths
  // (19.05 / 1.5875 floats to 12.000000000000002, showing 13 for 12 passes).
  const passes = zPassDepths(settings.depthMm, settings.depthPerPassMm).length;
  return [
    `${passes} ${passes === 1 ? 'pass' : 'passes'}`,
    `stepover ${settings.stepoverPercent}%`,
    ...(settings.cutDirection === undefined || !DIRECTED_CUT_TYPES.has(settings.cutType)
      ? []
      : [settings.cutDirection]),
    cncTabsPart(settings),
    ...cncEntryPart(settings),
    ...(settings.finishAllowanceMm !== undefined && settings.finishAllowanceMm > 0
      ? [`finish allowance ${formatMm(settings.finishAllowanceMm)} mm`]
      : []),
    ...(settings.pocketStrategy !== undefined && settings.pocketStrategy !== 'offset'
      ? [`${settings.pocketStrategy} pocket`]
      : []),
    feedSourcePart(settings),
  ].join(SEPARATOR);
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
  if (entry.title !== undefined) return entry.title;
  const thickness = entry.thicknessMm === undefined ? '' : ` ${formatMm(entry.thicknessMm)} mm`;
  return `${entry.materialName}${thickness}`;
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

function cncTabsPart(settings: CncLayerSettings): string {
  if (!settings.tabsEnabled) return 'tabs off';
  return `tabs ${settings.tabsPerShape} per shape (${formatMm(settings.tabWidthMm)} × ${formatMm(settings.tabHeightMm)} mm)`;
}

function cncEntryPart(settings: CncLayerSettings): ReadonlyArray<string> {
  if (settings.rampEntryDeg !== undefined) return [`ramp entry ${settings.rampEntryDeg}°`];
  if (settings.helixEntry !== undefined) return ['helix entry'];
  return [];
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
