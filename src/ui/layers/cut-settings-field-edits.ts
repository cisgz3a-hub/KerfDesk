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

/** Showing an absent Line option at its default is not an operation edit.
 * Keep stored values and deliberate edits, even an explicit default, while
 * leaving artwork-selection patches to their existing changed-control path. */
export function withoutUntouchedLineDefaults(
  form: HTMLFormElement,
  patch: LayerPatch,
  layer: Layer,
  changed: ReadonlyMap<string, HTMLElement>,
): LayerPatch {
  return Object.fromEntries(
    Object.entries(patch).filter(([name, value]) => {
      const key = name as keyof typeof LINE_OPTION_DEFAULTS;
      const control = changed.get(name);
      return !(
        Object.hasOwn(LINE_OPTION_DEFAULTS, key) &&
        layer[key] === undefined &&
        value === LINE_OPTION_DEFAULTS[key] &&
        (control === undefined || !form.contains(control))
      );
    }),
  );
}

const LINE_OPTION_DEFAULTS = {
  overcutMm: 0,
  perforationEnabled: false,
  perforationCutMm: DEFAULT_PERFORATION_CUT_MM,
  perforationSkipMm: DEFAULT_PERFORATION_SKIP_MM,
  tabLayout: 'count',
  tabCutPowerPercent: 0,
} as const satisfies LayerPatch;
