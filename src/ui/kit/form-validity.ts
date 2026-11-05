// Form submission without the browser's step check (performance audit S6-P2-2,
// ADR-690).
//
// A number field's `step` sets how far its arrow keys move it. It must never
// refuse a command: many fields show more decimals than their step (the Grid
// array's totals are n × the design's size, to 0.01 mm, in a 0.1 mm field; DPI
// is 304.8 at 12 lines/mm in a 1 DPI field), and any accepts a finer typed value
// (a 1000.25 mm/min speed). With `min` set, the browser measured steps from
// `min`, so 223.85 in a `min=0 step=0.1` field failed its check and the form
// never submitted, with no message in the app. Counts are the handlers' job:
// they round or refuse a fraction with their own message, as every dialog test
// that submits past the browser already relies on.
//
// Every form therefore sets `noValidate` and submits through `checkedSubmit`,
// which reports every other problem the browser would have: a value below
// `min` or above `max`, an unreadable number, a missing required value, or a
// field's own message (`setCustomValidity`).

type ValidatedControl = Element & {
  readonly willValidate: boolean;
  readonly validity: ValidityState;
  reportValidity(): boolean;
};

/** Whether `validity` fails for a reason other than falling between steps. */
export function refusesSubmit(validity: ValidityState): boolean {
  return (
    validity.badInput ||
    validity.customError ||
    validity.patternMismatch ||
    validity.rangeOverflow ||
    validity.rangeUnderflow ||
    validity.tooLong ||
    validity.tooShort ||
    validity.typeMismatch ||
    validity.valueMissing
  );
}

/**
 * Reports the first control, in document order, that refuses submission, as the
 * browser's own check would. Returns whether one did.
 */
export function formProblemReported(form: HTMLFormElement): boolean {
  for (const element of Array.from(form.elements)) {
    if (!isValidatedControl(element) || !element.willValidate) continue;
    if (!refusesSubmit(element.validity)) continue;
    element.reportValidity();
    return true;
  }
  return false;
}

/** A `noValidate` form's submit handler: runs `handler` only when no control refuses. */
export function checkedSubmit(
  handler?: (event: React.FormEvent<HTMLFormElement>) => void,
): (event: React.FormEvent<HTMLFormElement>) => void {
  return (event) => {
    if (formProblemReported(event.currentTarget)) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
}

function isValidatedControl(element: Element): element is ValidatedControl {
  return 'willValidate' in element && 'validity' in element && 'reportValidity' in element;
}
