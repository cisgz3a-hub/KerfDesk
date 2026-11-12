// The .egv twin of Save G-code's warnings (ADR-703 Amendment 1, code quality
// audit C2 D6-P2-1), as rd-job-warnings.ts is for .rd. Save .egv and the K40
// USB job encode through this one function, so both carry the warnings Save
// G-code and Start show: compile diagnostics ("will NOT be cut", a kerf side
// assumed), job intent and cut order.

import type { PreparedOutput } from '../../io/gcode';
import { emitPreparedEgvFile, type EmitEgvOptions, type EmitEgvResult } from '../../io/egv';
import { detectMachineJobWarnings } from './machine-job-warnings';

export type EgvWithJobWarnings =
  | (Extract<EmitEgvResult, { readonly ok: true }> & {
      readonly jobWarnings: ReadonlyArray<string>;
    })
  | Extract<EmitEgvResult, { readonly ok: false }>;

export function emitPreparedEgvWithJobWarnings(
  prepared: PreparedOutput,
  options: EmitEgvOptions = {},
): EgvWithJobWarnings {
  const result = emitPreparedEgvFile(prepared, options);
  if (!result.ok) return result;
  const jobWarnings = prepared.ok
    ? detectMachineJobWarnings(prepared.project, null, null, prepared)
    : [];
  return { ...result, jobWarnings };
}
