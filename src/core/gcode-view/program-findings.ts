// findProgramIssues — the Program Health report (ADR-255 stage 6).
//
// Runs every check over a parsed program and returns findings ordered
// most-severe first, then by source line. INFORMATIONAL ONLY: the report
// describes, it never refuses (CLAUDE.md rule 7 / ADR-228). Callers feed it
// to the Inspector panel and the Job Review warnings list.

import {
  afterEndFinding,
  cannedCycleFinding,
  cutBeforeSpindleFinding,
  cutWithoutFeedFinding,
  junkLineFinding,
  noMotionFinding,
  noProgramEndFinding,
  rapidPlungeFinding,
  rapidThroughMaterialFinding,
  skippedMotionFinding,
  unitsNotDeclaredFinding,
  unsupportedWordFindings,
} from './finding-checks';
import { severityRank, type FindingSeverity, type ProgramFinding } from './finding-types';
import type { GcodeRenderModel } from './render-model-types';

const SINGLE_CHECKS = [
  rapidThroughMaterialFinding,
  rapidPlungeFinding,
  cannedCycleFinding,
  cutBeforeSpindleFinding,
  cutWithoutFeedFinding,
  skippedMotionFinding,
  junkLineFinding,
  afterEndFinding,
  noMotionFinding,
  unitsNotDeclaredFinding,
  noProgramEndFinding,
] as const;

export function findProgramIssues(model: GcodeRenderModel): ReadonlyArray<ProgramFinding> {
  const findings: ProgramFinding[] = [...unsupportedWordFindings(model)];
  for (const check of SINGLE_CHECKS) {
    const finding = check(model);
    if (finding !== null) findings.push(finding);
  }
  return [...findings].sort(compareFindings);
}

export function countBySeverity(
  findings: ReadonlyArray<ProgramFinding>,
): Readonly<Record<FindingSeverity, number>> {
  const counts: Record<FindingSeverity, number> = { info: 0, notice: 0, warning: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

// Most severe first; within a severity, earliest line first so the list reads
// in program order. Program-wide findings (no line) sort after located ones.
function compareFindings(left: ProgramFinding, right: ProgramFinding): number {
  const bySeverity = severityRank(right.severity) - severityRank(left.severity);
  if (bySeverity !== 0) return bySeverity;
  const leftLine = left.line ?? Number.MAX_SAFE_INTEGER;
  const rightLine = right.line ?? Number.MAX_SAFE_INTEGER;
  if (leftLine !== rightLine) return leftLine - rightLine;
  return left.id.localeCompare(right.id);
}
