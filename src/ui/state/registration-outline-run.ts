// The Start from a registration jig's outline last burned with (ADR-057
// Amendment 6). Both runs anchor to the outline, so the artwork lands inside
// the burned outline only when it burns from the same Start from and job
// origin; Job Review compares the artwork run against this record.

import type { JobOriginPlacement, JobPlacementSettings } from '../../core/job';
import { findRegistrationBoxes, type Project } from '../../core/scene';
import { minOf } from '../../core/util';

export type RegistrationOutlineRun = {
  readonly placement: JobPlacementSettings;
  /** The burned outline set: each outline's shape and its place within the
   * set, wherever the set sits on the canvas. Another set never matches. */
  readonly outlines: string;
};

/** The record of a finished outline run of `project`'s jig. A resolved origin
 * left out is Absolute Coordinates, as in the prepared Start. */
export function registrationOutlineRunFor(
  project: Project,
  jobOrigin: JobOriginPlacement | undefined,
): RegistrationOutlineRun {
  return { placement: placementOf(jobOrigin), outlines: outlineSetKey(project) };
}

/** Where the outline of `project`'s jig burned from, or null when no outline
 * run of this jig set was seen in this session. */
export function registrationOutlinePlacement(
  project: Project,
  run: RegistrationOutlineRun | null | undefined,
): JobPlacementSettings | null {
  return run != null && run.outlines === outlineSetKey(project) ? run.placement : null;
}

export function placementOf(jobOrigin: JobOriginPlacement | undefined): JobPlacementSettings {
  return jobOrigin === undefined
    ? { startFrom: 'absolute', anchor: 'front-left' }
    : { startFrom: jobOrigin.startFrom, anchor: jobOrigin.anchor };
}

function outlineSetKey(project: Project): string {
  const boxes = [...findRegistrationBoxes(project.scene)].sort((a, b) => a.id.localeCompare(b.id));
  const left = minOf(boxes.map((box) => box.transform.x));
  const top = minOf(boxes.map((box) => box.transform.y));
  return JSON.stringify(
    boxes.map((box) => [
      box.id,
      box.spec,
      { ...box.transform, x: box.transform.x - left, y: box.transform.y - top },
    ]),
  );
}
