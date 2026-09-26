// The removal preview needs a cone for every V-bit and engraver. One with no
// valid tip angle is drawn at 60° (core/sim tool kernels), which is a guess,
// not the bit. Name those bits so the preview's V is not read as theirs
// (ADR-425). Display only: CAM and G-code are unchanged.

import { isValidCncTipAngleDeg } from '../../core/cnc-tip-angle';
import type { Toolpath } from '../../core/job';
import type { Project } from '../../core/scene';
import { toolpathToolsByToolKey } from './toolpath-tools';

export const ASSUMED_PREVIEW_TIP_ANGLE_DEG = 60;

export function assumedTipAngleNotice(project: Project, toolpath: Toolpath): string | null {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return null;
  const names = new Set<string>();
  for (const tool of toolpathToolsByToolKey(machine, toolpath).values()) {
    const conical = tool.kind === 'v-bit' || tool.kind === 'engraving';
    if (conical && !isValidCncTipAngleDeg(tool.tipAngleDeg)) names.add(tool.name);
  }
  if (names.size === 0) return null;
  const list = [...names].join(', ');
  const subject = names.size === 1 ? `${list} has` : `${list} have`;
  return (
    `${subject} no valid tip angle, so the cut preview draws a ` +
    `${ASSUMED_PREVIEW_TIP_ANGLE_DEG}° V. Set the angle in the bit library for its true shape.`
  );
}
