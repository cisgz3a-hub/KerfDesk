// Progress from a long neighbourhood filter (ADR-245 Amendment 2). The Image
// Studio's preview worker turns it into the dialog's progress bar. A filter
// calls it with the fraction done, 0..1, never decreasing; it must not touch
// the pixels, so passing one changes nothing a filter writes.
export type FilterProgress = (fraction: number) => void;

/** Reports nothing: what a filter calls when nobody asked for progress. */
export const IGNORE_PROGRESS: FilterProgress = () => undefined;

/** Report `from..to` of the whole as a pass runs 0..1 (for multi-pass filters). */
export function progressSpan(
  progress: FilterProgress | undefined,
  from: number,
  to: number,
): FilterProgress {
  if (progress === undefined) return IGNORE_PROGRESS;
  return (fraction) => progress(from + (to - from) * fraction);
}
