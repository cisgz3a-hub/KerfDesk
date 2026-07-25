// Save-path twin of the Start path's partitionEmitPreflight (rule 7 /
// ADR-228): heuristic policy findings warn on export, they do not refuse it.
// Non-finite offsets ('scan-offset-out-of-range') and every other preflight
// code stay blocking.

import type { PreflightCode, PreflightIssue } from '../../core/preflight';

const ADVISORY_SAVE_PREFLIGHT_CODES: ReadonlySet<PreflightCode> = new Set<PreflightCode>([
  'scan-offset-above-cap',
  // Rule 7 names this case outright: "configured no-go zones ... may warn in
  // Job Review, but must never refuse Frame or Start." The Start path already
  // demotes it; the export path did not, so a job Start would stream could not
  // be written to a file. Both no-go refusals fire when clearance cannot be
  // PROVEN (a standalone file whose work origin is chosen later, or a hand-set
  // origin with no trusted machine offset) rather than when a collision is
  // found - so they refused every user-origin job on a no-homing router with
  // one clamp zone, with no geometric cause. Writing a file moves no axis.
  'no-go-zone-collision',
]);

export type SavePreflightSplit = {
  readonly blocking: ReadonlyArray<PreflightIssue>;
  readonly advisories: ReadonlyArray<PreflightIssue>;
};

export function partitionSavePreflight(issues: ReadonlyArray<PreflightIssue>): SavePreflightSplit {
  const blocking: PreflightIssue[] = [];
  const advisories: PreflightIssue[] = [];
  for (const issue of issues) {
    (ADVISORY_SAVE_PREFLIGHT_CODES.has(issue.code) ? advisories : blocking).push(issue);
  }
  return { blocking, advisories };
}
