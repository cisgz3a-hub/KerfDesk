// Post-compile checks for an .egv export (ADR-703): the shared motion
// preflight (io/motion-preflight.ts) over the moves the stream commands, each
// planned step one move in mm.

import {
  LHY_STEPS_PER_MM,
  type LhyMotionPart,
} from '../../core/controllers/lihuiyu/lhy-motion-plan';
import type { PreflightIssue } from '../../core/preflight';
import type { Project } from '../../core/scene';
import { runMotionPreflight, type MotionPreflightFrame } from '../motion-preflight';

export type EgvPreflightFrame = MotionPreflightFrame;

export function runEgvPreflight(
  project: Project,
  motion: ReadonlyArray<LhyMotionPart>,
  frame: EgvPreflightFrame,
): ReadonlyArray<PreflightIssue> {
  return runMotionPreflight(project, motion, frame, (step) => ({
    xMm: step.x / LHY_STEPS_PER_MM,
    yMm: step.y / LHY_STEPS_PER_MM,
    burn: step.burn,
  }));
}
