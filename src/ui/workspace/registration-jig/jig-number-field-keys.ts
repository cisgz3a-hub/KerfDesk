import type { KeyboardEvent } from 'react';

type FieldKeyEvent = KeyboardEvent<HTMLInputElement>;

/**
 * Enter and Escape for the jig editor's number fields, which apply their value
 * when they are left. Enter applies the value and Escape drops it, as number
 * fields do elsewhere. Either way focus goes to the editor surface, where the
 * canvas keys work. Focus must not drop to the page: a field re-created with
 * its new value would then send focus to the editor's first button (the
 * tutorial), and the same Enter would press it.
 */
export function jigNumberFieldKeys(shown: string): {
  readonly onKeyDown: (event: FieldKeyEvent) => void;
  readonly onKeyDownCapture: (event: FieldKeyEvent) => void;
} {
  return {
    onKeyDown: (event) => {
      if (event.key !== 'Enter' || composing(event)) return;
      event.preventDefault();
      leaveField(event.currentTarget);
    },
    // On the way down: the editor moves focus off the field on Escape before
    // the field's own key handler would run.
    onKeyDownCapture: (event) => {
      if (event.key === 'Escape' && !composing(event)) event.currentTarget.value = shown;
    },
  };
}

// While an IME is composing, Enter and Escape belong to its candidate window
// (as in use-dialog-a11y), so the typed value stays.
function composing(event: FieldKeyEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

function leaveField(field: HTMLInputElement): void {
  const surface = field.closest<HTMLElement>('[role="dialog"]');
  if (surface === null) field.blur();
  else surface.focus();
}
