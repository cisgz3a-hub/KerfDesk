// Post-compile checks for an .egv export (ADR-703), as rd-preflight.ts does
// for .rd: runPreflight scans G-code text, so each planned move becomes one
// line in mm — `G0 X Y S0` for a beam-off move and `G1 X Y S<power>` for a
// burn — and a finding's "Line N" names that move's layer instead. Every
// finding is an advisory: this path never refuses (rule 7 / ADR-228).

import {
  LHY_STEPS_PER_MM,
  type LhyMotionPart,
} from '../../core/controllers/lihuiyu/lhy-motion-plan';
import { rotaryAppliesTo, rotaryWrapLimitMm } from '../../core/job';
import { runPreflight, type PreflightIssue, type PreflightOptions } from '../../core/preflight';
import type { Project } from '../../core/scene';

export type EgvPreflightFrame = Pick<PreflightOptions, 'motionOffset' | 'coordinateMode'>;

export function runEgvPreflight(
  project: Project,
  motion: ReadonlyArray<LhyMotionPart>,
  frame: EgvPreflightFrame,
): ReadonlyArray<PreflightIssue> {
  const lines: string[] = [];
  const layerOfLine: string[] = [];
  for (const { group, steps } of motion) {
    for (const step of steps) {
      const target = `X${mm(step.x)} Y${mm(step.y)}`;
      lines.push(step.burn ? `G1 ${target} S${group.power}` : `G0 ${target} S0`);
      layerOfLine.push(group.layerId);
    }
  }
  const wrapLimitMm = rotaryAppliesTo(project.device, project.machine)
    ? rotaryWrapLimitMm(project.device, project.machine)
    : null;
  const preflight = runPreflight(project, lines.join('\n'), {
    ...frame,
    ...(wrapLimitMm === null ? {} : { boundsHeightOverrideMm: wrapLimitMm }),
  });
  return preflight.issues.map((issue) => withLayerLabel(issue, layerOfLine));
}

function withLayerLabel(issue: PreflightIssue, layerOfLine: ReadonlyArray<string>): PreflightIssue {
  const line = /^Line (\d+): /.exec(issue.message);
  if (line === null) return issue;
  const layerId = layerOfLine[Number(line[1]) - 1];
  if (layerId === undefined) return issue;
  return { ...issue, message: `Layer ${layerId}: ${issue.message.slice(line[0].length)}` };
}

function mm(steps: number): string {
  return (steps / LHY_STEPS_PER_MM).toFixed(3);
}
