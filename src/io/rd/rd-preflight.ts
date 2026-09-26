// Post-compile checks for a .rd export (audit RU-7). Save G-code runs
// runPreflight over the emitted program — bed bounds, no-go zones, laser-on
// travel, blank feeds and the layer settings — and a Ruida profile's only
// output is this export, so it runs the SAME runPreflight over the moves the
// .rd file commands. runPreflight scans G-code text, so each planned move
// becomes one line: `G0 X Y S0` for a laser-off travel (0x88) and
// `G1 X Y S<power>` for a cut (0xA8), in mm. A finding's "Line N" names that
// move's layer instead, since the file has no G-code lines. Every finding is
// an advisory: this path never refuses (rule 7 / ADR-228).

import type { RdEncodeResult } from '../../core/controllers/ruida';
import { rotaryAppliesTo, rotaryWrapLimitMm } from '../../core/job';
import { runPreflight, type PreflightIssue, type PreflightOptions } from '../../core/preflight';
import type { Project } from '../../core/scene';

type RdMotion = Extract<RdEncodeResult, { readonly ok: true }>['motion'];

export type RdPreflightFrame = Pick<PreflightOptions, 'motionOffset' | 'coordinateMode'>;

export function runRdPreflight(
  project: Project,
  motion: RdMotion,
  frame: RdPreflightFrame,
): ReadonlyArray<PreflightIssue> {
  const lines: string[] = [];
  const layerOfLine: string[] = [];
  for (const { group, steps } of motion) {
    for (const step of steps) {
      const target = `X${mm(step.xUm)} Y${mm(step.yUm)}`;
      lines.push(step.cut ? `G1 ${target} S${group.power}` : `G0 ${target} S0`);
      layerOfLine.push(group.layerId);
    }
  }
  // One revolution is the rotary wrap limit, as in the G-code save (ADR-127).
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

function mm(um: number): string {
  return (um / 1000).toFixed(3);
}
