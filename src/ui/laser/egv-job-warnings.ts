// The .egv twin of Save G-code's warnings (ADR-703 Amendment 1, code quality
// audit C2 D6-P2-1), as rd-job-warnings.ts is for .rd. Save .egv and the K40
// USB job encode through this one function, so both carry the warnings Save
// G-code and Start show: compile diagnostics ("will NOT be cut", a kerf side
// assumed), job intent and cut order. On a Y-port rotary they also carry the
// row check on the K40's 1/1000 in grid, as the Moshiboard job does (ADR-703
// Amendment 2, C2 verification E2-P2-2), as the branded SharedJobWarnings a
// link job requires (ADR-705 Amendment 7).

import { LHY_STEPS_PER_MM } from '../../core/controllers/lihuiyu/lhy-motion-plan';
import type { PreparedOutput } from '../../io/gcode';
import { emitPreparedEgvFile, type EmitEgvOptions, type EmitEgvResult } from '../../io/egv';
import {
  detectRotaryRowGridWarnings,
  type RotaryRowGrid,
} from './job-review/rotary-row-step-warnings';
import { sharedJobWarnings, type SharedJobWarnings } from './shared-job-warnings';

/** A K40 board places every coordinate on a whole 1/1000 inch step. */
export const K40_ROW_GRID: RotaryRowGrid = {
  stepsPerUnit: LHY_STEPS_PER_MM,
  stepsText: 'K40 position (1/1000 in, 0.0254 mm of machine Y)',
};

export type EgvWithJobWarnings =
  | (Extract<EmitEgvResult, { readonly ok: true }> & {
      readonly jobWarnings: SharedJobWarnings;
    })
  | Extract<EmitEgvResult, { readonly ok: false }>;

export function emitPreparedEgvWithJobWarnings(
  prepared: PreparedOutput,
  options: EmitEgvOptions = {},
): EgvWithJobWarnings {
  const result = emitPreparedEgvFile(prepared, options);
  if (!result.ok) return result;
  // emitPreparedEgvFile refuses a failed preparation, so `prepared` is ok here.
  if (!prepared.ok) return { ok: false, messages: [] };
  const rowChecks = detectRotaryRowGridWarnings(prepared.project, prepared.job, K40_ROW_GRID);
  return { ...result, jobWarnings: sharedJobWarnings(prepared, rowChecks) };
}
