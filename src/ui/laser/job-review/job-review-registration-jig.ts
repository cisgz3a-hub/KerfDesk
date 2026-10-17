import type { Job } from '../../../core/job';
import {
  findRegistrationBoxes,
  machineKindOf,
  REGISTRATION_LAYER_ID,
  type Project,
} from '../../../core/scene';

export type RegistrationJigReviewOutput = 'box' | 'artwork' | 'mixed';

/** Describe the compiled artifact, never infer the reviewed burn from live toggles. */
export function registrationJigReviewOutput(
  project: Project,
  job: Pick<Job, 'groups'>,
): RegistrationJigReviewOutput | null {
  const boxes = findRegistrationBoxes(project.scene);
  if (
    machineKindOf(project.machine) !== 'laser' ||
    boxes.length === 0 ||
    boxes.some((box) => box.provenance === 'captured-board') ||
    job.groups.length === 0
  )
    return null;
  const outline = job.groups.some((group) => group.layerId === REGISTRATION_LAYER_ID);
  const artwork = job.groups.some((group) => group.layerId !== REGISTRATION_LAYER_ID);
  return outline ? (artwork ? 'mixed' : 'box') : 'artwork';
}

export type ReviewFacts = {
  readonly registrationJigOutput?: RegistrationJigReviewOutput | null;
};

export function facts(project: Project, job: Pick<Job, 'groups'>): ReviewFacts {
  return { registrationJigOutput: registrationJigReviewOutput(project, job) };
}
