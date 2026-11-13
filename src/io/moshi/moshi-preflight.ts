// Post-compile checks for a Moshi job (ADR-705): the shared motion preflight
// (io/motion-preflight.ts) over the moves the programs command, in machine
// coordinates, each planned step one move in mm.

import type { MoshiMotionPart } from '../../core/controllers/moshi';
import { milsToMm } from '../../core/controllers/moshi';
import type { PreflightIssue } from '../../core/preflight';
import type { Project } from '../../core/scene';
import { runMotionPreflight } from '../motion-preflight';

export function runMoshiPreflight(
  project: Project,
  motion: ReadonlyArray<MoshiMotionPart>,
): ReadonlyArray<PreflightIssue> {
  return runMotionPreflight(project, motion, { coordinateMode: 'machine' }, (step) => ({
    xMm: milsToMm(step.x),
    yMm: milsToMm(step.y),
    burn: step.cut,
  }));
}
