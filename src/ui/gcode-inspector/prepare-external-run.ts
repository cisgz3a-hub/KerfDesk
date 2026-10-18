// prepare-external-run — the exact program and review behind the Run dialog
// (ADR-630). A refusal here is factual: the file cannot be sent as a job, or
// it never moves in X or Y, so there is nothing for the Frame to trace.

import {
  normalizeExternalProgram,
  type ExternalProgram,
  type ExternalProgramReview,
} from '../../core/external-program';
import type { ExternalRun } from './external-run';

export type PreparedExternalRun =
  | { readonly kind: 'refused'; readonly reasons: ReadonlyArray<string> }
  | {
      readonly kind: 'ready';
      readonly run: ExternalRun;
      readonly program: ExternalProgram;
      readonly review: ExternalProgramReview;
    };

export const NO_FRAME_ENVELOPE =
  'The program never moves in X or Y, so there is no outline for the Frame to trace.';

export function prepareExternalRun(
  name: string,
  text: string,
  review: (gcode: string) => ExternalProgramReview,
): PreparedExternalRun {
  const normalized = normalizeExternalProgram(text);
  if (normalized.kind === 'refused') return normalized;
  const { program } = normalized;
  const result = review(program.gcode);
  if (result.envelope === null) return { kind: 'refused', reasons: [NO_FRAME_ENVELOPE] };
  return {
    kind: 'ready',
    run: { name, gcode: program.gcode, envelope: result.envelope },
    program,
    review: result,
  };
}
