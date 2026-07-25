// Save-path twin of the Start path's partitionEmitPreflight (rule 7 /
// ADR-228): heuristic policy findings warn on export, they do not refuse it.
//
// This file previously inverted that rule. It listed the ADVISORIES
// ('scan-offset-above-cap' alone) and blocked everything else, so policy
// findings that merely warn on Start — out-of-bed, no-go-zone collisions,
// plunged travel, speed/power range — refused the export outright. Blocking is
// now keyed off the one canonical compile-integrity set both paths share, so
// Save refuses exactly what Start refuses and nothing more.

import { COMPILE_INTEGRITY_PREFLIGHT_CODES, type PreflightIssue } from '../../core/preflight';

export type SavePreflightSplit = {
  readonly blocking: ReadonlyArray<PreflightIssue>;
  readonly advisories: ReadonlyArray<PreflightIssue>;
};

export function partitionSavePreflight(issues: ReadonlyArray<PreflightIssue>): SavePreflightSplit {
  const blocking: PreflightIssue[] = [];
  const advisories: PreflightIssue[] = [];
  for (const issue of issues) {
    (COMPILE_INTEGRITY_PREFLIGHT_CODES.has(issue.code) ? blocking : advisories).push(issue);
  }
  return { blocking, advisories };
}
