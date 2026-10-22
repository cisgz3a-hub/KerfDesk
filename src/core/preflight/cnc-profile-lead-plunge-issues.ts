import type { Job } from '../job';
import type { PreflightIssue } from './preflight';

/**
 * ADR-250 Amendment 3: per layer, the profile passes that kept their straight
 * plunge because every lead would cut into a part the job keeps. Advisory
 * only: the program is safe as compiled, and only the entry mark moves back
 * onto the wall. Read from the markers on this exact compiled Job.
 */
export function cncProfileLeadPlungeIssues(job: Job | undefined): ReadonlyArray<PreflightIssue> {
  const counts = new Map<string, number>();
  for (const group of job?.groups ?? []) {
    if (group.kind !== 'cnc') continue;
    const blocked = group.passes.filter(
      (pass) => (pass.kind === 'contour' || pass.kind === 'path3d') && pass.leadBlocked === true,
    ).length;
    if (blocked > 0) counts.set(group.layerId, (counts.get(group.layerId) ?? 0) + blocked);
  }
  return [...counts].map(([layerId, count]) => ({
    code: 'cnc-profile-lead-plunge',
    message:
      `Layer ${layerId}: ${count === 1 ? '1 pass plunges' : `${count} passes plunge`} ` +
      'straight down onto the cut line instead of using a lead-in, because a lead-in there ' +
      'would cut into a part next to it. The plunge can leave a mark on that edge. ' +
      'Leave more space around the part to keep the lead-in.',
  }));
}
