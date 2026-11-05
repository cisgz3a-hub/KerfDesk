// Form submission without the browser's decimal step check (performance audit
// S6-P2-2, ADR-690).
//
// A decimal `step` sets how far a number field's arrow keys move it. It must
// never refuse a command: many fields show more decimals than their step (the
// Grid array's totals are n × the design's size, to 0.01 mm, in a 0.1 mm field),
// and any accepts a finer typed value. With `min` set, the browser measured
// steps from `min`, so 223.85 in a `min=0 step=0.1` field failed its check and
// the form never submitted, with no message in the app.
//
// Every form therefore sets `noValidate` and submits through `checkedSubmit`,
// which reports every other problem the browser would have: a value below
// `min` or above `max`, an unreadable number, a missing required value, or a
// field's own message (`setCustomValidity`). A whole-number step (an explicit
// `step="1"`, or none, which means 1) still refuses a fraction: those fields
// count things, as Focus Test's `steps` field does on purpose.

type ValidatedControl = Element & {
  readonly willValidate: boolean;
  readonly validity: ValidityState;
  reportValidity(): boolean;
};

/** Whether the browser's verdict on `control` should stop the form submitting. */
export function refusesSubmit(control: ValidatedControl): boolean {
  const validity = control.validity;
  return (
    (validity.stepMismatch && wholeStep(control)) ||
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
    if (!refusesSubmit(element)) continue;
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

function wholeStep(control: Element): boolean {
  const step = control.getAttribute('step')?.trim() ?? '';
  return step === '' || Number.isInteger(Number(step));
}

function isValidatedControl(element: Element): element is ValidatedControl {
  return 'willValidate' in element && 'validity' in element && 'reportValidity' in element;
}
