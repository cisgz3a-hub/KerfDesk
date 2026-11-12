import { DEFAULT_OVERSCAN_MM } from '../../core/job/compile-job-defaults';
import {
  DEFAULT_PERFORATION_CUT_MM,
  DEFAULT_PERFORATION_SKIP_MM,
} from '../../core/job/operation-cut-extras';
import type { Layer } from '../../core/scene';
import type { LayerPatch } from './cut-settings-draft';

export function cutSettingField(target: EventTarget | null):
  | {
      readonly name: string;
      readonly control: HTMLInputElement | HTMLSelectElement;
    }
  | undefined {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement))
    return undefined;
  const name = target.dataset.setting ?? target.name;
  return {
    name: name === 'lineIntervalMm' || name === 'imageDpi' ? 'linesPerMm' : name,
    control: target,
  };
}

/** Unchecked checkboxes remain controls even though FormData omits them. A
 * process change can replace a control with a fresh one of the same name. Track
 * the edited element itself so remounted fallbacks never become explicit edits. */
export function changedCutSettingsPatch(
  form: HTMLFormElement,
  patch: LayerPatch,
  changed: ReadonlyMap<string, HTMLElement>,
): LayerPatch {
  return Object.fromEntries(
    Object.entries(patch).filter(([key]) => {
      const control = changed.get(key);
      return control !== undefined && form.contains(control);
    }),
  );
}

/** Showing an absent option at its default is not an operation edit. Keep
 * stored values and deliberate edits, even an explicit default, while leaving
 * artwork-selection patches to their existing changed-control path. Without
 * this a no-op Apply stores the shown defaults, the operation no longer matches
 * its linked recipe, and an ADR-496 §6 Process switch stops reseeding it. */
export function withoutUntouchedOptionDefaults(
  form: HTMLFormElement,
  patch: LayerPatch,
  layer: Layer,
  changed: ReadonlyMap<string, HTMLElement>,
): LayerPatch {
  return Object.fromEntries(
    Object.entries(patch).filter(([name, value]) => {
      const key = name as keyof typeof OPTION_DEFAULTS;
      const control = changed.get(name);
      return !(
        Object.hasOwn(OPTION_DEFAULTS, key) &&
        layer[key] === undefined &&
        value === OPTION_DEFAULTS[key] &&
        (control === undefined || !form.contains(control))
      );
    }),
  );
}

/** What each optional field compiles as when the operation does not store it.
 * Every value is the compiler's own fallback for an absent key. */
const OPTION_DEFAULTS = {
  // Line (ADR-415, ADR-494): operation-cut-extras.ts.
  overcutMm: 0,
  perforationEnabled: false,
  perforationCutMm: DEFAULT_PERFORATION_CUT_MM,
  perforationSkipMm: DEFAULT_PERFORATION_SKIP_MM,
  tabLayout: 'count',
  tabCutPowerPercent: 0,
  // Fill and Image. ADR-495 Automatic overscan runs only when `=== true`
  // (automatic-overscan.ts); ADR-492 steps by `passAngleStepDeg ?? 0`
  // (scan-pass-angles.ts); an uncalibrated bidirectional scan is allowed only
  // when set (scan-direction-policy.ts).
  autoOverscan: false,
  passAngleStepDeg: 0,
  allowUncalibratedBidirectionalScan: false,
  // Image only. ADR-415 overscan falls back to DEFAULT_OVERSCAN_MM
  // (imageOverscanMmFor); ADR-492 scans at `imageScanAngleDeg ?? 0` and
  // cross-hatches only when `imageCrossHatch === true` (scan-pass-angles.ts).
  imageOverscanMm: DEFAULT_OVERSCAN_MM,
  imageScanAngleDeg: 0,
  imageCrossHatch: false,
} as const satisfies LayerPatch;
