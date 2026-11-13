// The .rd twin of Save G-code's warnings (code quality audit C2 D2-P2-1;
// ADR-705 Amendment 4). Save G-code, the tiled export and G-code Start add
// detectMachineJobWarnings to their output: compile diagnostics (a kerf that
// closed up a slot, a kerf side assumed, a Fill that failed), job intent and
// cut order. The .rd encoder is core code and cannot reach those UI checks,
// so every .rd route (Save .rd on the window or the worker, and the Ruida
// network job) encodes through this one function and gets the same list, as
// the branded SharedJobWarnings a link job requires (ADR-705 Amendment 7).

import { emitPreparedRdFile, type EmitRdOptions, type EmitRdResult } from '../../io/rd';
import type { PreparedOutput } from '../../io/gcode';
import { sharedJobWarnings, type SharedJobWarnings } from './shared-job-warnings';

export type RdWithJobWarnings =
  | (Extract<EmitRdResult, { readonly ok: true }> & { readonly jobWarnings: SharedJobWarnings })
  | Extract<EmitRdResult, { readonly ok: false }>;

export function emitPreparedRdWithJobWarnings(
  prepared: PreparedOutput,
  options: EmitRdOptions = {},
): RdWithJobWarnings {
  const result = emitPreparedRdFile(prepared, options);
  if (!result.ok) return result;
  // emitPreparedRdFile refuses a failed preparation, so `prepared` is ok here.
  if (!prepared.ok) return { ok: false, messages: [] };
  return { ...result, jobWarnings: sharedJobWarnings(prepared) };
}
