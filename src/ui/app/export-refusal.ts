// A refused export is one error toast (annoyance audit A1-P3-9, ADR-656
// Amendment 4). It used to be a native alert, which froze the page and, for
// Save G-code, sat over a dialog that then needed its own Cancel.
//
// The first reason is the toast's line. Any further reasons fold under it, so
// several refusals still take one slot and one dismissal (ADR-687's fold).

import type { ToastOptions, ToastVariant } from '../state/toast-store';

type PushToast = (message: string, variant?: ToastVariant, options?: ToastOptions) => void;

/** One slot for every export refusal: a second attempt rewrites the first. */
export const EXPORT_REFUSAL_TOAST_KEY = 'export-refused';

export const GCODE_SAVE_REFUSED = 'Cannot save G-code';

/** The single line a refusal shows, e.g. "Cannot save G-code: No output layers." */
export function exportRefusalLine(heading: string, reasons: ReadonlyArray<string>): string {
  const [first, ...rest] = reasons;
  if (first === undefined) return `${heading}.`;
  if (rest.length === 0) return `${heading}: ${first}`;
  const more = rest.length === 1 ? '1 more reason' : `${rest.length} more reasons`;
  return `${heading}: ${first} (${more})`;
}

export function pushExportRefusal(
  pushToast: PushToast,
  heading: string,
  reasons: ReadonlyArray<string>,
): void {
  pushToast(exportRefusalLine(heading, reasons), 'error', {
    key: EXPORT_REFUSAL_TOAST_KEY,
    details: reasons.slice(1),
  });
}
