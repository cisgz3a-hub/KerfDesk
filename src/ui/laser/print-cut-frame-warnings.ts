import type { JobOriginPlacement } from '../../core/job';
import type { SimilarityTransform } from '../../core/registration';
import { registrationFigures } from '../../core/registration/registration-check';
import { registrationOutputConflict, type Project } from '../../core/scene';

export const REGISTRATION_MIXED_OUTPUT_WARNING =
  'Registration jig: the box and your artwork are both set to burn in the same pass. The physical Frame traces the combined output; confirm this is intentional before continuing.';

export const PRINT_CUT_JOB_ORIGIN_WARNING =
  'Print-and-Cut registration and job-origin placement are both active. The physical Frame traces the combined transform; confirm the traced position before continuing.';

/** `registration`: the Print-and-Cut registration output applies; undefined when none is active. */
export function collectPrintCutFrameWarnings(
  project: Project,
  registration: SimilarityTransform | null | undefined,
  jobOrigin: JobOriginPlacement | undefined,
): string[] {
  const warnings: string[] = [];
  if (registrationOutputConflict(project.scene)) {
    warnings.push(REGISTRATION_MIXED_OUTPUT_WARNING);
  }
  if (registration !== undefined && jobOrigin !== undefined && jobOrigin.startFrom !== 'absolute') {
    warnings.push(PRINT_CUT_JOB_ORIGIN_WARNING);
  }
  const unusual = unusualRegistrationWarning(project, registration);
  if (unusual !== null) warnings.push(unusual);
  return warnings;
}

// A registration whose scale or turn looks like a capture mistake informs Job
// Review and never refuses Frame or Start (ADR-443 Amendment 1, rule 7): it
// may be the sheet, and the dialog already asked the operator to confirm it.
function unusualRegistrationWarning(
  project: Project,
  registration: SimilarityTransform | null | undefined,
): string | null {
  const targets = project.printAndCutTargets;
  if (registration === undefined || registration === null || targets === undefined) return null;
  const figures = registrationFigures([targets.first, targets.second], registration);
  if (figures.unusual === null) return null;
  return `Print-and-Cut registration: ${figures.measured} ${figures.unusual} The physical Frame traces the registered output; confirm it lands on the printed sheet before continuing.`;
}
