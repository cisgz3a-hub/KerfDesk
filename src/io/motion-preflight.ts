// Post-compile checks for a controller route's own motion (audit RU-7; ADR-705
// Amendment 7, C2 verification E2-P3-3). Save G-code runs runPreflight over
// the emitted program: bed bounds, no-go zones, laser-on travel, blank feeds
// and the layer settings. The .rd, .egv and Moshiboard routes have no G-code
// text, so each writes the moves its encoder commands as G-code lines in mm
// (`G0 X Y S0` laser off, `G1 X Y S<power>` a burn) and runs the SAME
// runPreflight here. A finding's "Line N" names that move's layer instead, and
// each finding is listed once (several moves of one layer can read the same).
// Every finding is an advisory: these routes never refuse (rule 7 / ADR-228).
// One revolution is the rotary wrap limit, as in the G-code save (ADR-127).

import { rotaryAppliesTo, rotaryWrapLimitMm } from '../core/job';
import { runPreflight, type PreflightIssue, type PreflightOptions } from '../core/preflight';
import { withoutRepeatedIssues } from '../core/preflight/without-repeated-issues';
import type { Project } from '../core/scene';

export type MotionPreflightFrame = Pick<PreflightOptions, 'motionOffset' | 'coordinateMode'>;

/** One planned move, in mm; `burn` is a move with the beam on. */
export type MotionPreflightMove = {
  readonly xMm: number;
  readonly yMm: number;
  readonly burn: boolean;
};

type MotionPart<Step> = {
  readonly group: { readonly layerId: string; readonly power: number };
  readonly steps: ReadonlyArray<Step>;
};

export function runMotionPreflight<Step>(
  project: Project,
  motion: ReadonlyArray<MotionPart<Step>>,
  frame: MotionPreflightFrame,
  toMove: (step: Step) => MotionPreflightMove,
): ReadonlyArray<PreflightIssue> {
  const lines: string[] = [];
  const layerOfLine: string[] = [];
  for (const { group, steps } of motion) {
    for (const step of steps) {
      const move = toMove(step);
      const target = `X${move.xMm.toFixed(3)} Y${move.yMm.toFixed(3)}`;
      lines.push(move.burn ? `G1 ${target} S${group.power}` : `G0 ${target} S0`);
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
  return withoutRepeatedIssues(preflight.issues.map((issue) => withLayerLabel(issue, layerOfLine)));
}

function withLayerLabel(issue: PreflightIssue, layerOfLine: ReadonlyArray<string>): PreflightIssue {
  const line = /^Line (\d+): /.exec(issue.message);
  if (line === null) return issue;
  const layerId = layerOfLine[Number(line[1]) - 1];
  if (layerId === undefined) return issue;
  return { ...issue, message: `Layer ${layerId}: ${issue.message.slice(line[0].length)}` };
}
