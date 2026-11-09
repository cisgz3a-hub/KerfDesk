// The emit stage for a rotary on a dedicated A or Z axis (ADR-693). The
// emitters and preflight run on the machine-space job with the turn in Y, as
// for a Y rotary; this stage then writes the turn under the chosen letter and
// zeroes it first. A controller with no such axis word, or a program that
// already uses the letter, gets no program at all: writing the turn as Y
// would run the gantry with the laser on instead of turning the part.

import { rotaryAxisSupported, type DedicatedRotaryAxis } from '../../core/devices';
import { rotaryOutputAxis } from '../../core/job';
import { rotaryAxisZeroLine, routeRotaryAxisLines } from '../../core/output/rotary-axis-output';
import type { OutputEmitOptions } from '../../core/output/output-strategy';
import type { PreflightResult } from '../../core/preflight';
import type { Project } from '../../core/scene';

export type RotaryAxisBody =
  | { readonly kind: 'ok'; readonly body: string }
  | { readonly kind: 'refused'; readonly preflight: PreflightResult };

/** The finished body with the turn on the project's rotary axis. */
export function routeRotaryAxisBody(
  project: Pick<Project, 'device' | 'machine'>,
  body: string,
): RotaryAxisBody {
  const axis = rotaryOutputAxis(project.device, project.machine);
  if (axis === null) return { kind: 'ok', body };
  const unsupported = rotaryAxisUnsupportedMessage(project, axis);
  if (unsupported !== null) return refused(unsupported);
  const routed = routeRotaryAxisLines(body, axis);
  if (routed.kind === 'conflict') {
    return refused(
      `The rotary is set to the ${axis} axis, but line ${routed.lineNumber} of the program ` +
        `already moves ${axis} (${routed.line.trim()}), so the part's turn could not be told ` +
        `apart from it. Choose another rotary axis in Rotary Setup. No output bytes were produced.`,
    );
  }
  return { kind: 'ok', body: `${rotaryAxisZeroLine(axis)}\n${routed.text}` };
}

/**
 * The finish on a dedicated axis. A Current Position job parks back at the
 * head's work position; its Y there is the anchor, which a dedicated axis puts
 * at turn 0. Writing the head's work Y would turn the part that many degrees
 * away at the end of the job.
 */
export function rotaryAxisFinishOptions<T extends OutputEmitOptions>(
  project: Pick<Project, 'device' | 'machine'>,
  options: T,
): T {
  if (rotaryOutputAxis(project.device, project.machine) === null) return options;
  const finish = options.finishPosition;
  if (finish === undefined || finish === null) return options;
  return { ...options, finishPosition: { x: finish.x, y: 0 } };
}

/** Why this controller cannot take the rotary's axis, or null. */
export function rotaryAxisUnsupportedMessage(
  project: Pick<Project, 'device'>,
  axis: DedicatedRotaryAxis,
): string | null {
  if (rotaryAxisSupported(project.device, axis)) return null;
  const controller = project.device.controllerKind ?? 'grbl-v1.1';
  return (
    `The rotary is set to the ${axis} axis, which KerfDesk cannot write for a ${controller} ` +
    'controller. Choose the Y axis in Rotary Setup and plug the rotary into the Y motor port, ' +
    'or use a grblHAL or FluidNC controller with an A axis. No output bytes were produced.'
  );
}

function refused(message: string): RotaryAxisBody {
  return {
    kind: 'refused',
    preflight: { ok: false, issues: [{ code: 'rotary-axis-unexecutable', message }] },
  };
}
