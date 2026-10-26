// prepare-external-run — the exact program and review behind the Run dialog
// (ADR-630). A refusal here is factual: the file cannot be sent as a job, or
// its parser has no finite motion envelope for the Frame to visit. The
// caller supplies normalized bytes and the fresh inspection of those bytes.

import { type ExternalProgram, type ExternalProgramReview } from '../../core/external-program';
import type { ExternalRun } from './external-run';
import type { RunStart } from './use-external-program';

export type PreparedExternalRun =
  | { readonly kind: 'refused'; readonly reasons: ReadonlyArray<string> }
  | {
      readonly kind: 'ready';
      readonly run: ExternalRun;
      readonly program: ExternalProgram;
      readonly review: ExternalProgramReview;
    };

export const NO_FRAME_ENVELOPE =
  'The Inspector could not construct a finite motion envelope for the Frame to visit.';

/** `start` is the work position the review's parse was read from. */
export function prepareExternalRun(
  name: string,
  program: ExternalProgram,
  start: RunStart,
  review: (gcode: string) => ExternalProgramReview,
): PreparedExternalRun {
  const result = review(program.gcode);
  if (result.envelope === null) return { kind: 'refused', reasons: [NO_FRAME_ENVELOPE] };
  return {
    kind: 'ready',
    run: {
      name,
      gcode: program.gcode,
      envelope: result.envelope,
      start,
      ...(program.controllerKind === undefined ? {} : { controllerKind: program.controllerKind }),
    },
    program,
    review: result,
  };
}
