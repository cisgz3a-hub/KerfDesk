// Program Health finding types (ADR-255 stage 6).
//
// Findings are INFORMATIONAL ONLY (ADR-255 §5, CLAUDE.md rule 7 / ADR-228).
// Nothing here blocks Frame, Start, parse, render, or export — a finding
// describes what the program says so the operator can decide.

export const FINDING_SEVERITY = {
  /** Worth knowing; no action implied. */
  info: 0,
  /** The program is unusual or partly un-renderable here. */
  notice: 1,
  /** The program says something an operator usually wants to look at. */
  warning: 2,
} as const;

export type FindingSeverity = keyof typeof FINDING_SEVERITY;

export type ProgramFinding = {
  /** Stable kebab-case identifier — safe to key UI and tests on. */
  readonly id: string;
  readonly severity: FindingSeverity;
  /** Short label, sentence case, no trailing period. */
  readonly title: string;
  /** One plain-language sentence: what was seen and why it is shown. */
  readonly detail: string;
  /** Zero-based raw line of the first occurrence; null when program-wide. */
  readonly line: number | null;
  /** How many times it occurs (1 for program-wide findings). */
  readonly count: number;
};

export function severityRank(severity: FindingSeverity): number {
  return FINDING_SEVERITY[severity];
}
