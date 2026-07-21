// Save-path twin of the Start path's partitionEmitPreflight (rule 7 /
// ADR-228): heuristic policy findings warn on export, they do not refuse it.
// Only the scan-offset MAGNITUDE cap is advisory today; non-finite offsets
// ('scan-offset-out-of-range') and every other preflight code stay blocking.

import type { PreflightCode, PreflightIssue } from '../../core/preflight';

const ADVISORY_SAVE_PREFLIGHT_CODES: ReadonlySet<PreflightCode> = new Set<PreflightCode>([
  'scan-offset-above-cap',
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
