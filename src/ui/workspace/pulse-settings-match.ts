// Which operations count as "the same settings" for the hover pulse (ADR-620):
// what output would do with them, not how they happen to be stored. Name,
// colour, visibility and sub-operation ids and labels do not count, and a
// setting an older operation never stored counts as the value output uses
// when it is absent.

import { DEFAULT_OVERSCAN_MM } from '../../core/job/compile-job-defaults';
import {
  DEFAULT_PERFORATION_CUT_MM,
  DEFAULT_PERFORATION_SKIP_MM,
  DEFAULT_TAB_SPACING_MM,
} from '../../core/job/operation-cut-extras';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerOperationSettingsEqual,
  type Layer,
  type LayerOperationSettings,
} from '../../core/scene';

export type MachineKind = 'laser' | 'cnc';

// Optional laser settings and the value output uses when one is absent
// (operation-cut-extras.ts, automatic-overscan.ts, scan-pass-angles.ts). The
// power mode and bidirectional scan offset are left out: absent, each comes
// from the machine, and no stored value means the same thing.
const OPTIONAL_LASER_DEFAULTS = {
  allowUncalibratedBidirectionalScan: false,
  perforationEnabled: false,
  perforationCutMm: DEFAULT_PERFORATION_CUT_MM,
  perforationSkipMm: DEFAULT_PERFORATION_SKIP_MM,
  overcutMm: 0,
  imageOverscanMm: DEFAULT_OVERSCAN_MM,
  tabLayout: 'count',
  tabSpacingMm: DEFAULT_TAB_SPACING_MM,
  tabMaxPerShape: 0,
  tabCutPowerPercent: 0,
  imageScanAngleDeg: 0,
  imageCrossHatch: false,
  passAngleStepDeg: 0,
  autoOverscan: false,
} as const satisfies Partial<LayerOperationSettings>;

/** Same settings for the active machine, as output would see them. */
export function sameOperationSettings(a: Layer, b: Layer, machine: MachineKind): boolean {
  if (machine === 'cnc') {
    // An operation with no CNC block cuts with the CNC defaults, as output does.
    return (
      canonicalJson(a.cnc ?? DEFAULT_CNC_LAYER_SETTINGS) ===
      canonicalJson(b.cnc ?? DEFAULT_CNC_LAYER_SETTINGS)
    );
  }
  return (
    sameLaserSettings(a, b) &&
    a.subLayers.length === b.subLayers.length &&
    a.subLayers.every((sub, index) => {
      const other = b.subLayers[index];
      // A sub-operation's id and label are bookkeeping; output reads these two.
      return (
        other !== undefined &&
        sub.enabled === other.enabled &&
        sameLaserSettings(sub.settings, other.settings)
      );
    })
  );
}

function sameLaserSettings(a: LayerOperationSettings, b: LayerOperationSettings): boolean {
  return layerOperationSettingsEqual(withOptionalDefaults(a), withOptionalDefaults(b));
}

function withOptionalDefaults(settings: LayerOperationSettings): LayerOperationSettings {
  const filled: Record<string, unknown> = { ...settings };
  for (const [key, value] of Object.entries(OPTIONAL_LASER_DEFAULTS)) filled[key] ??= value;
  return filled as LayerOperationSettings;
}

/** JSON with object keys sorted, so the same settings saved in another key order still match. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : 1)))
      : entry,
  );
}
