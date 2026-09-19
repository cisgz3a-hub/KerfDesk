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
