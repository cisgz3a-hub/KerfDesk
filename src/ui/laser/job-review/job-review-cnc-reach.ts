// The CNC reach review of the exact prepared Start program. Each bit's flute and
// stickout comparison reads its deepest compiled cut, because the review's
// re-parse of the program is bounded (ADR-572 Amendments 1 and 2).

import { cncToolSectionMaximumDepthsMm } from '../../../core/cnc/output-representation';
import type { Job } from '../../../core/job';
import type { Project } from '../../../core/scene';
import { cncProgramReachWarnings } from '../../../io/cnc/cnc-program-reach';
import type { CncToolPlanEntry } from '../../state/cnc-tool-plan';

export function jobReviewCncReachWarnings(prepared: {
  readonly prepared: { readonly project: Project; readonly job: Job };
  readonly gcode: string;
  readonly cncToolPlan?: ReadonlyArray<CncToolPlanEntry>;
}): ReadonlyArray<string> {
  return cncProgramReachWarnings(
    prepared.prepared.project,
    prepared.gcode,
    prepared.cncToolPlan,
    cncToolSectionMaximumDepthsMm(prepared.prepared.job),
  );
}
