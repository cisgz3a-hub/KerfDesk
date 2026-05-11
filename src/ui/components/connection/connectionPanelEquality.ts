/**
 * T1-144: pure equality comparators extracted from
 * ConnectionPanelMain. These two helpers (`samePreflightSummary`,
 * `sameMessages`) are used by the panel's setMessages / setPreflight
 * effects to skip redundant state updates — if the new value is
 * structurally equal to the existing one, the setState call is
 * skipped to prevent re-render storms.
 *
 * Pre-T1-144 they were top-level functions inside the 2600+ line
 * panel; testing them required loading the whole file (which pulls
 * Electron / serial / preflight modules). Post-T1-144 the
 * field-by-field structural-equality contracts are pinned in
 * isolation.
 */
import type { PreflightSummary } from '../../../core/preflight/Preflight';

/**
 * Structural equality for `PreflightSummary`:
 *   - score / canStart / blockers / warnings: direct compare (the
 *     last two are pre-computed counts, not the issue array)
 *   - validatedTicket.ticketId compared if either side has a ticket
 *   - issues compared field-by-field (id / severity / category /
 *     title / detail / fix) in order
 *
 * Same-length arrays in different order will return false — order
 * matters because the panel renders issues in the order they appear.
 */
export function samePreflightSummary(a: PreflightSummary, b: PreflightSummary): boolean {
  if (
    a.score !== b.score
    || a.canStart !== b.canStart
    || a.blockers !== b.blockers
    || a.warnings !== b.warnings
  ) {
    return false;
  }
  if (a.validatedTicket?.ticketId !== b.validatedTicket?.ticketId) return false;
  const ia = a.issues;
  const ib = b.issues;
  if (ia.length !== ib.length) return false;
  for (let i = 0; i < ia.length; i++) {
    const x = ia[i];
    const y = ib[i];
    if (
      x.id !== y.id
      || x.severity !== y.severity
      || x.category !== y.category
      || x.title !== y.title
      || x.detail !== y.detail
      || x.fix !== y.fix
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Order-sensitive equality for the panel's message arrays. Returns
 * true for the same-reference case (cheap fast-path) AND for
 * structurally identical arrays. Strings are compared with `===`.
 */
export function sameMessages(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
