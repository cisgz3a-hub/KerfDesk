// Post-compile checks for a .rd export (audit RU-7): the shared motion
// preflight (io/motion-preflight.ts) over the moves the .rd file commands, a
// laser-off travel (0x88) and a cut (0xA8) each one move in mm.

import type { RdEncodeResult } from '../../core/controllers/ruida';
import type { PreflightIssue } from '../../core/preflight';
import type { Project } from '../../core/scene';
import { runMotionPreflight, type MotionPreflightFrame } from '../motion-preflight';

type RdMotion = Extract<RdEncodeResult, { readonly ok: true }>['motion'];

export type RdPreflightFrame = MotionPreflightFrame;

export function runRdPreflight(
  project: Project,
  motion: RdMotion,
  frame: RdPreflightFrame,
): ReadonlyArray<PreflightIssue> {
  return runMotionPreflight(project, motion, frame, (step) => ({
    xMm: step.xUm / 1000,
    yMm: step.yUm / 1000,
    burn: step.cut,
  }));
}
