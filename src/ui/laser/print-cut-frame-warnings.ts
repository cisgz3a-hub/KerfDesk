import type { JobOriginPlacement } from '../../core/job';
import { registrationOutputConflict, type Project } from '../../core/scene';

export const REGISTRATION_MIXED_OUTPUT_WARNING =
  'Registration jig: the box and your artwork are both set to burn in the same pass. The physical Frame traces the combined output; confirm this is intentional before continuing.';

export const PRINT_CUT_JOB_ORIGIN_WARNING =
  'Print-and-Cut registration and job-origin placement are both active. The physical Frame traces the combined transform; confirm the traced position before continuing.';

export function collectPrintCutFrameWarnings(
  project: Project,
  registrationActive: boolean,
  jobOrigin: JobOriginPlacement | undefined,
): string[] {
  const warnings: string[] = [];
  if (registrationOutputConflict(project.scene)) {
    warnings.push(REGISTRATION_MIXED_OUTPUT_WARNING);
  }
  if (registrationActive && jobOrigin !== undefined && jobOrigin.startFrom !== 'absolute') {
    warnings.push(PRINT_CUT_JOB_ORIGIN_WARNING);
  }
  return warnings;
}
