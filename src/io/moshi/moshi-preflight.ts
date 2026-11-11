// Post-compile checks for a Moshi job (ADR-705), as the .rd export runs them
// (io/rd/rd-preflight.ts): the SAME runPreflight Save G-code runs — bed bounds,
// no-go zones, laser-on travel, blank feeds and layer settings — over the
// moves the programs command, each written as one G-code line in mm (`G0 X Y
// S0` laser off, `G1 X Y S<power>` a cut). A finding's "Line N" names that
// move's layer instead. Every finding is an advisory: this path never refuses.

import type { MoshiMotionPart } from '../../core/controllers/moshi';
import { milsToMm } from '../../core/controllers/moshi';
import { rotaryAppliesTo, rotaryWrapLimitMm } from '../../core/job';
import { runPreflight, type PreflightIssue } from '../../core/preflight';
import type { Project } from '../../core/scene';

export function runMoshiPreflight(
  project: Project,
  motion: ReadonlyArray<MoshiMotionPart>,
): ReadonlyArray<PreflightIssue> {
  const lines: string[] = [];
  const layerOfLine: string[] = [];
  for (const { group, steps } of motion) {
    for (const step of steps) {
      const target = `X${mm(step.x)} Y${mm(step.y)}`;
      lines.push(step.cut ? `G1 ${target} S${group.power}` : `G0 ${target} S0`);
      layerOfLine.push(group.layerId);
    }
  }
  const wrapLimitMm = rotaryAppliesTo(project.device, project.machine)
    ? rotaryWrapLimitMm(project.device, project.machine)
    : null;
  const preflight = runPreflight(project, lines.join('\n'), {
    coordinateMode: 'machine',
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

function mm(mils: number): string {
  return milsToMm(mils).toFixed(3);
}
