// Which kept trace adjustments the selected style uses (ADR-560). The dialog
// keeps one set of overrides across style changes (ADR-434 Amendment 1), but a
// style reads only the controls its panel shows, the brightness band applies
// only to Manual detection or the alpha mask, and the alpha mask only to an
// image with transparency. "Settings edited" follows the adjustments that
// change this trace; the others are named as kept but not used here.

import type { TraceOptions } from '../../core/trace';
import { offersDiagonalContacts } from './DiagonalContactsControl';
import {
  joinsLineEnds,
  mergeLightBurnTraceSettings,
  traceDetectionMode,
  type LightBurnTraceSettingOverrides,
} from './trace-options';

type OverrideKey = keyof LightBurnTraceSettingOverrides;

export type TraceSettingEdits = {
  /** The adjustments this style uses change the options it traces with. */
  readonly edited: boolean;
  /** Controls, in panel order, whose kept values the style or image ignores. */
  readonly unused: ReadonlyArray<string>;
};

// The control each override belongs to, in panel order.
const OVERRIDE_LABELS: Readonly<Record<OverrideKey, string>> = {
  photoDetail: 'Detail',
  photoBrightness: 'Brightness',
  photoContrast: 'Contrast',
  photoGamma: 'Midtones',
  photoInvert: 'Invert',
  colourCount: 'Colours',
  colourLayerOutput: 'Layers',
  keepBackground: 'Trace background colour',
  edgeSensitivity: 'Sensitivity',
  edgeDetail: 'Detail',
  edgeMinimumLinePx: 'Minimum line',
  detectionMode: 'Detection',
  sketchTrace: 'Detection',
  cutoffLuma: 'Cutoff',
  thresholdLuma: 'Threshold',
  invert: 'Invert',
  despeckleMinPixels: 'Remove ink specks',
  ignoreLessThanPixels: 'Ignore Less Than',
  hybridMaxStrokeWidthMm: 'Max stroke width',
  centerlineJoinGapPx: 'Join gaps',
  fillPinholeCracks: 'Fill tiny holes',
  smoothness: 'Smoothness',
  optimize: 'Optimize',
  turnPolicy: 'Diagonal contacts',
  traceTransparency: 'Trace alpha mask',
};

const PHOTO_KEYS: ReadonlyArray<OverrideKey> = [
  'photoDetail',
  'photoBrightness',
  'photoContrast',
  'photoGamma',
  'photoInvert',
];
const COLOUR_LAYER_KEYS: ReadonlyArray<OverrideKey> = [
  'colourCount',
  'colourLayerOutput',
  'keepBackground',
  'despeckleMinPixels',
];
const EDGE_KEYS: ReadonlyArray<OverrideKey> = [
  'edgeSensitivity',
  'edgeDetail',
  'edgeMinimumLinePx',
  'smoothness',
  'optimize',
  'traceTransparency',
];
const FILLED_KEYS: ReadonlyArray<OverrideKey> = [
  'despeckleMinPixels',
  'fillPinholeCracks',
  'smoothness',
  'optimize',
  'traceTransparency',
];
const FILLED_DETECTION_KEYS: ReadonlyArray<OverrideKey> = ['detectionMode', 'sketchTrace'];
const BAND_KEYS: ReadonlyArray<OverrideKey> = ['cutoffLuma', 'thresholdLuma'];

export function traceSettingEdits(
  preset: TraceOptions,
  overrides: LightBurnTraceSettingOverrides,
  sourceHasTransparency: boolean | undefined,
): TraceSettingEdits {
  const used = usedOverrideKeys(preset, overrides, sourceHasTransparency === true);
  const active: Record<string, unknown> = {};
  const unused = new Set<string>();
  for (const key of Object.keys(OVERRIDE_LABELS) as OverrideKey[]) {
    const value = overrides[key];
    if (value === undefined || noAdjustment(key, value, sourceHasTransparency)) continue;
    if (used.has(key)) active[key] = value;
    else unused.add(OVERRIDE_LABELS[key]);
  }
  // Line + fill converts its millimetre width through the placement, outside
  // the merge (hybrid-stroke-width.ts), so a set width counts by itself.
  const edited =
    active['hybridMaxStrokeWidthMm'] !== undefined ||
    optionsKey(mergeLightBurnTraceSettings(preset, active as LightBurnTraceSettingOverrides)) !==
      optionsKey(mergeLightBurnTraceSettings(preset, {}));
  return { edited, unused: [...unused] };
}

// Choosing the preset's own detection adjusts nothing, and the alpha mask
// cannot act on an image without transparency (the panel says so there).
function noAdjustment(
  key: OverrideKey,
  value: unknown,
  sourceHasTransparency: boolean | undefined,
): boolean {
  if (key === 'detectionMode') return value === 'preset';
  return key === 'traceTransparency' && sourceHasTransparency !== true;
}

function usedOverrideKeys(
  preset: TraceOptions,
  overrides: LightBurnTraceSettingOverrides,
  transparentSource: boolean,
): ReadonlySet<OverrideKey> {
  if (preset.photoDetail !== undefined) return new Set(PHOTO_KEYS);
  if (preset.colourLayers !== undefined) return new Set(COLOUR_LAYER_KEYS);
  // The alpha mask reads transparency instead of brightness, so Invert stands
  // down, and a filled style's band selects alpha. Its Detection choice waits
  // unlisted: editing the alpha band sets it to Manual (TraceSettingsControls).
  const alphaMask =
    transparentSource && (overrides.traceTransparency ?? preset.traceTransparency) === true;
  const edge = preset.traceMode === 'edge';
  const used = new Set<OverrideKey>(edge ? EDGE_KEYS : filledStyleKeys(preset));
  if (!alphaMask) used.add('invert');
  const band = !edge && (alphaMask || traceDetectionMode(preset, overrides) === 'manual');
  if (band) for (const key of BAND_KEYS) used.add(key);
  return used;
}

// Filled-style controls that only some of those styles show.
const OPTIONAL_FILLED_KEYS: ReadonlyArray<
  readonly [OverrideKey, (preset: TraceOptions) => boolean]
> = [
  ['ignoreLessThanPixels', (preset) => preset.traceMode !== 'centerline'],
  ['hybridMaxStrokeWidthMm', (preset) => preset.traceMode === 'hybrid'],
  ['centerlineJoinGapPx', joinsLineEnds],
  ['turnPolicy', offersDiagonalContacts],
];

function filledStyleKeys(preset: TraceOptions): ReadonlyArray<OverrideKey> {
  const shown = OPTIONAL_FILLED_KEYS.filter(([, shows]) => shows(preset)).map(([key]) => key);
  return [...FILLED_KEYS, ...FILLED_DETECTION_KEYS, ...shown];
}

function optionsKey(options: TraceOptions): string {
  const entries = Object.entries(options).filter(([, value]) => value !== undefined);
  entries.sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify(entries);
}
