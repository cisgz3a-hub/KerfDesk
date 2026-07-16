// buildCncPassResumeJob (ADR-215) — CNC recovery re-enters as a NEW ordinary
// Job that starts at the beginning of a pass and keeps every later pass and
// group in source order.
//
// Why a pass boundary is the safe re-entry point: each stepdown is its own
// constant-Z CncPass, so the pass start is already cut when the boundary is
// chosen at or before the interrupted pass — shallower passes cleared it, and
// the interrupted pass cut its own start before dying. The ordinary emitter
// then lifts to safe Z, starts and dwells the spindle, rapids, and plunges at
// plunge feed (cnc-grbl-strategy.ts preamble), so the cutter is at full speed
// before any material contact and the plunge lands in cleared kerf. The cost
// is recutting the already-cut part of one pass, never skipped material.
//
// This builder never reads controller acknowledgements. Choosing the boundary
// is the caller's responsibility (cnc-resume-point.ts default + operator
// review); this function only slices the sealed prepared Job.

import type { CncGroup, Job } from '../job';

export type CncPassResumeJob = {
  readonly kind: 'resume-job';
  readonly job: Job;
  /** Source passes omitted before the boundary — they must already be cut. */
  readonly omittedPassCount: number;
  readonly totalPassCount: number;
};

export type CncPassResumeJobResult =
  | CncPassResumeJob
  | { readonly kind: 'error'; readonly reason: 'invalid-resume-index' | 'non-cnc-group' };

export function buildCncPassResumeJob(
  source: Job,
  groupIndex: number,
  passIndex: number,
): CncPassResumeJobResult {
  if (!Number.isInteger(groupIndex) || !Number.isInteger(passIndex)) {
    return { kind: 'error', reason: 'invalid-resume-index' };
  }
  // A recovery job must be a pure CNC program: a mixed job would silently
  // drop its laser groups at emit time instead of refusing here.
  if (source.groups.some((group) => group.kind !== 'cnc')) {
    return { kind: 'error', reason: 'non-cnc-group' };
  }
  const group = source.groups[groupIndex];
  if (group?.kind !== 'cnc' || passIndex < 0 || passIndex >= group.passes.length) {
    return { kind: 'error', reason: 'invalid-resume-index' };
  }
  const resumeGroup: CncGroup = { ...group, passes: group.passes.slice(passIndex) };
  return {
    kind: 'resume-job',
    job: { groups: [resumeGroup, ...source.groups.slice(groupIndex + 1)] },
    omittedPassCount: countPassesBefore(source, groupIndex) + passIndex,
    totalPassCount: countPassesBefore(source, source.groups.length),
  };
}

function countPassesBefore(source: Job, groupIndex: number): number {
  let count = 0;
  for (let i = 0; i < groupIndex; i += 1) {
    const group = source.groups[i];
    if (group?.kind === 'cnc') count += group.passes.length;
  }
  return count;
}
