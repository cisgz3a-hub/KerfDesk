import type { Job } from '../../core/job';

/** One contiguous cutter section in the exact order the CNC emitter runs it. */
export type CncToolPlanEntry = {
  readonly id: string | null;
  readonly name: string | null;
};

/**
 * Derive host-side cutter metadata from the prepared Job after section ordering.
 * Every entry after the first corresponds to one generated M0 boundary. Keeping
 * this beside the stream avoids parsing safety state from comments and leaves
 * emitted G-code byte-identical.
 */
export function cncToolPlan(job: Job): ReadonlyArray<CncToolPlanEntry> {
  const plan: CncToolPlanEntry[] = [];
  let previousKey: string | null = null;
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    const key = group.toolId ?? '';
    if (previousKey === key) continue;
    plan.push({ id: group.toolId ?? null, name: group.toolName ?? null });
    previousKey = key;
  }
  return plan;
}
