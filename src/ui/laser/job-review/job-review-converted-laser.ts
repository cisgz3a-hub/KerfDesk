// The review gate's part of ADR-637 Amendment 8: a CNC that KerfDesk 1.0.29
// may have made from a laser carries its question in the review model, and a
// model that still holds it is never confirmed. The operator answers it in
// the dialog (JobReviewConvertedLaser), which rebuilds the review.

import type { Project } from '../../../core/scene';
import {
  convertedLaserQuestion,
  type ConvertedLaserControllerState,
} from '../../state/converted-laser-question';
import type { JobReviewModel } from './job-review-model';

export function withConvertedLaserQuestion(
  model: JobReviewModel,
  project: Project,
  controller: ConvertedLaserControllerState,
): JobReviewModel {
  const convertedLaser = convertedLaserQuestion(project, controller);
  return convertedLaser === null ? model : { ...model, convertedLaser };
}

/** A Confirm starts only the artifact the operator saw, and never past an
 *  open machine-type question. */
export function confirmableReview(rebuiltModel: JobReviewModel, sameArtifact: boolean): boolean {
  return rebuiltModel.convertedLaser === undefined && sameArtifact;
}
