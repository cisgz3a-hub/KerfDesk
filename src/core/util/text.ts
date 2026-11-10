// Small text guards shared by loaders and forms (code quality audit C1,
// C2-P3-1). Every copy replaced by an import had the same body.

/** True for a string that holds something other than white space. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A form field's text as a number: blank gives NaN, not zero. */
export function numberFromDraft(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text);
}
