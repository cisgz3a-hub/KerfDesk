// Simple view's never-hide rule (ADR-698): a laser setting Simple view hides
// is still shown, as a value, whenever it would change this burn from what a
// new operation does. Pure: no React, no store.
//
// Every operation setting is classified here, and a test holds that: a key
// added to LAYER_OPERATION_SETTING_KEYS later fails it until it is placed, so
// a new setting can never be hidden by omission. When in doubt a setting is
// listed for more processes, not fewer: an extra line costs a glance, a missing
// one hides a change to the burn.

import { objectPowerScalePercent } from '../../core/effective-output';
import { activePhotoToneCurve } from '../../core/raster/photo-tone-curve';
import { LAYER_DEFAULTS, type LayerMode, type LayerOperationSettings } from '../../core/scene';
import type { MixedOperationFields } from './selected-operation-mixed';

/** Shown in Simple view as controls: never listed. */
export const SIMPLE_VIEW_VISIBLE_KEYS = ['mode', 'power', 'speed', 'passes'] as const;

type HiddenKey = Exclude<keyof LayerOperationSettings, (typeof SIMPLE_VIEW_VISIBLE_KEYS)[number]>;

type HiddenSpec = {
  readonly label: string;
  readonly modes: ReadonlyArray<LayerMode>;
  /** What the burn uses when the key is absent; a new operation's value. */
  readonly baseline: unknown;
  readonly unit?: string;
  /** A detail of another switch: only listed while that switch is on. */
  readonly when?: (settings: LayerOperationSettings) => boolean;
};

const ALL: ReadonlyArray<LayerMode> = ['line', 'fill', 'image'];
const LINE: ReadonlyArray<LayerMode> = ['line'];
const FILL: ReadonlyArray<LayerMode> = ['fill'];
const IMAGE: ReadonlyArray<LayerMode> = ['image'];
const SCANNED: ReadonlyArray<LayerMode> = ['fill', 'image'];

const tabsOn = (s: LayerOperationSettings): boolean => s.tabsEnabled;
const tabsBySpacing = (s: LayerOperationSettings): boolean =>
  s.tabsEnabled && s.tabLayout === 'spacing';
const perforated = (s: LayerOperationSettings): boolean => s.perforationEnabled === true;
const leads = (s: LayerOperationSettings): boolean =>
  s.leadInEnabled === true || s.leadOutEnabled === true;
const rampOn = (s: LayerOperationSettings): boolean => (s.fillRampLengthMm ?? 0) > 0;
const scanBothWays = (s: LayerOperationSettings): boolean =>
  s.mode === 'image' ? s.imageBidirectional : s.fillBidirectional;

export const SIMPLE_VIEW_HIDDEN_SPECS: Readonly<Record<HiddenKey, HiddenSpec>> = {
  powerMode: { label: 'Power mode', modes: ALL, baseline: 'constant' },
  minPower: { label: 'Min power', modes: ALL, baseline: LAYER_DEFAULTS.minPower, unit: '%' },
  airAssist: { label: 'Air assist', modes: ALL, baseline: LAYER_DEFAULTS.airAssist },
  kerfOffsetMm: {
    label: 'Kerf offset',
    modes: ['line', 'fill'],
    baseline: LAYER_DEFAULTS.kerfOffsetMm,
    unit: 'mm',
  },
  tabsEnabled: { label: 'Tabs', modes: LINE, baseline: LAYER_DEFAULTS.tabsEnabled },
  tabSizeMm: {
    label: 'Tab size',
    modes: LINE,
    baseline: LAYER_DEFAULTS.tabSizeMm,
    unit: 'mm',
    when: tabsOn,
  },
  tabsPerShape: {
    label: 'Tabs per shape',
    modes: LINE,
    baseline: LAYER_DEFAULTS.tabsPerShape,
    when: tabsOn,
  },
  tabSkipInnerShapes: {
    label: 'Skip tabs on inner shapes',
    modes: LINE,
    baseline: LAYER_DEFAULTS.tabSkipInnerShapes,
    when: tabsOn,
  },
  tabLayout: { label: 'Tab layout', modes: LINE, baseline: 'count', when: tabsOn },
  tabSpacingMm: {
    label: 'Tab spacing',
    modes: LINE,
    baseline: undefined,
    unit: 'mm',
    when: tabsBySpacing,
  },
  tabMaxPerShape: {
    label: 'Most tabs per shape',
    modes: LINE,
    baseline: undefined,
    when: tabsBySpacing,
  },
  tabCutPowerPercent: {
    label: 'Tab power',
    modes: LINE,
    baseline: undefined,
    unit: '%',
    when: tabsOn,
  },
  hatchAngleDeg: { label: 'Angle', modes: FILL, baseline: LAYER_DEFAULTS.hatchAngleDeg, unit: '°' },
  hatchSpacingMm: {
    label: 'Line spacing',
    modes: FILL,
    baseline: LAYER_DEFAULTS.hatchSpacingMm,
    unit: 'mm',
  },
  // Also the Line contour-entry target (LayerRowFields' SharedRunwayInput).
  fillOverscanMm: {
    label: 'Overscan / contour entry',
    modes: ['line', 'fill'],
    baseline: LAYER_DEFAULTS.fillOverscanMm,
    unit: 'mm',
  },
  fillStyle: { label: 'Fill style', modes: FILL, baseline: LAYER_DEFAULTS.fillStyle },
  fillBidirectional: {
    label: 'Scan both ways',
    modes: FILL,
    baseline: LAYER_DEFAULTS.fillBidirectional,
  },
  allowUncalibratedBidirectionalScan: {
    label: 'Allow uncalibrated two-way scan',
    modes: SCANNED,
    baseline: undefined,
    when: scanBothWays,
  },
  bidirectionalScanOffsetMm: {
    label: 'Scan offset',
    modes: SCANNED,
    baseline: undefined,
    unit: 'mm',
    when: scanBothWays,
  },
  fillCrossHatch: { label: 'Cross-hatch', modes: FILL, baseline: LAYER_DEFAULTS.fillCrossHatch },
  ditherAlgorithm: { label: 'Dither', modes: IMAGE, baseline: LAYER_DEFAULTS.ditherAlgorithm },
  linesPerMm: {
    label: 'Lines per mm',
    modes: IMAGE,
    baseline: LAYER_DEFAULTS.linesPerMm,
  },
  imageBidirectional: {
    label: 'Scan both ways',
    modes: IMAGE,
    baseline: LAYER_DEFAULTS.imageBidirectional,
  },
  negativeImage: { label: 'Negative image', modes: IMAGE, baseline: LAYER_DEFAULTS.negativeImage },
  passThrough: { label: 'Pass-through', modes: IMAGE, baseline: LAYER_DEFAULTS.passThrough },
  dotWidthCorrectionMm: {
    label: 'Dot width correction',
    modes: IMAGE,
    baseline: LAYER_DEFAULTS.dotWidthCorrectionMm,
    unit: 'mm',
  },
  perforationEnabled: { label: 'Perforation', modes: LINE, baseline: false },
  perforationCutMm: {
    label: 'Perforation cut',
    modes: LINE,
    baseline: undefined,
    unit: 'mm',
    when: perforated,
  },
  perforationSkipMm: {
    label: 'Perforation skip',
    modes: LINE,
    baseline: undefined,
    unit: 'mm',
    when: perforated,
  },
  overcutMm: { label: 'Overcut', modes: LINE, baseline: 0, unit: 'mm' },
  imageOverscanMm: { label: 'Overscan', modes: IMAGE, baseline: 5, unit: 'mm' },
  imageScanAngleDeg: { label: 'Scan angle', modes: IMAGE, baseline: 0, unit: '°' },
  imageCrossHatch: { label: 'Cross-hatch', modes: IMAGE, baseline: false },
  passAngleStepDeg: { label: 'Angle step per pass', modes: SCANNED, baseline: 0, unit: '°' },
  autoOverscan: { label: 'Automatic overscan', modes: SCANNED, baseline: false },
  leadInEnabled: { label: 'Lead-in', modes: LINE, baseline: false },
  leadOutEnabled: { label: 'Lead-out', modes: LINE, baseline: false },
  leadStyle: { label: 'Lead style', modes: LINE, baseline: undefined, when: leads },
  leadLengthMm: {
    label: 'Lead length',
    modes: LINE,
    baseline: undefined,
    unit: 'mm',
    when: leads,
  },
  leadAngleDeg: { label: 'Lead angle', modes: LINE, baseline: undefined, unit: '°', when: leads },
  leadSide: { label: 'Lead side', modes: LINE, baseline: undefined, when: leads },
  photoToneCurve: { label: 'Material tone curve', modes: IMAGE, baseline: undefined },
  // ADR-699: a Fill ramp changes the burn whenever its length is set.
  fillRampLengthMm: { label: 'Ramp length', modes: FILL, baseline: 0, unit: 'mm' },
  fillRampOuterEdge: { label: 'Ramp outer edge', modes: FILL, baseline: false, when: rampOn },
  // ADR-704: absent is the galvo machine's own default.
  galvoFrequencyKhz: { label: 'Galvo frequency', modes: ALL, baseline: undefined, unit: 'kHz' },
  galvoPulseWidthNs: { label: 'Galvo pulse width', modes: ALL, baseline: undefined, unit: 'ns' },
};

export type HiddenSettingValue = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
};

/**
 * The settings Simple view hides that change this burn: each one this
 * process uses whose value is not what a new operation would have, or that
 * differs between the selected artworks.
 */
export function simpleViewHiddenValues(
  settings: LayerOperationSettings,
  mixed: MixedOperationFields = {},
): ReadonlyArray<HiddenSettingValue> {
  const values: HiddenSettingValue[] = [];
  for (const [key, spec] of Object.entries(SIMPLE_VIEW_HIDDEN_SPECS) as Array<
    [HiddenKey, HiddenSpec]
  >) {
    if (!spec.modes.includes(settings.mode)) continue;
    if (mixed[key] === true) {
      values.push({ key, label: spec.label, value: 'differs between the selected artwork' });
      continue;
    }
    if (spec.when !== undefined && !spec.when(settings)) continue;
    // A neutral tone curve changes nothing; only an active one is listed.
    const value = key === 'photoToneCurve' ? activePhotoToneCurve(settings[key]) : settings[key];
    if (value === undefined || sameValue(value, spec.baseline)) continue;
    values.push({ key, label: spec.label, value: formatValue(value, spec.unit) });
  }
  return values;
}

/** The artwork Power multiplier is hidden only while it is 100% for every
 *  inspected artwork: a multiplier that lowers the burn stays in sight. */
export function showsPowerMultiplier(
  simple: boolean,
  objects: ReadonlyArray<{ readonly powerScale?: number }>,
): boolean {
  return !simple || objects.some((object) => objectPowerScalePercent(object) !== 100);
}

function sameValue(value: unknown, baseline: unknown): boolean {
  return typeof value === 'object' ? false : value === baseline;
}

function formatValue(value: unknown, unit: string | undefined): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') {
    const text = String(Number(value.toFixed(3)));
    return unit === undefined
      ? text
      : unit === '°' || unit === '%'
        ? `${text}${unit}`
        : `${text} ${unit}`;
  }
  if (typeof value === 'string') return value.replace(/-/g, ' ');
  return 'set';
}
