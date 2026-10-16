import type { Job } from '../../../core/job';
import { focusTestWarnings } from '../../../core/job/focus-test';
import type { Project } from '../../../core/scene';

/** Only emitted Focus samples describe this review. The retained project may
 * still contain unused operations, unselected artwork and disabled subpasses. */
export function compiledFocusTestWarnings(prepared: { job: Job; project: Project }): string[] {
  return focusTestWarnings(
    prepared.job.groups.flatMap((group) =>
      group.kind === 'cut' && group.focusTest !== undefined
        ? [{ output: true, focusTest: group.focusTest }]
        : [],
    ),
    prepared.project.device,
  );
}
