// One copy of each finding (ADR-703 Amendment 2, C2 verification E2-P3-3).
// runPreflight repeats some pre-emit findings (the controlled-travel feed),
// and a controller route's preflight adapter relabels "Line N" as "Layer L",
// so distinct moves of one layer can read the same. The .rd and .egv routes
// list each finding once; the panels key their lists by the text.

import type { PreflightIssue } from './preflight';

export function withoutRepeatedIssues(
  issues: ReadonlyArray<PreflightIssue>,
): ReadonlyArray<PreflightIssue> {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}\n${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
