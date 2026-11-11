// The .rd twin of Save G-code's warnings (code quality audit C2 D2-P2-1;
// ADR-705 Amendment 4). Save G-code, the tiled export and G-code Start add
// detectMachineJobWarnings to their output: compile diagnostics (a kerf that
// closed up a slot, a kerf side assumed, a Fill that failed), job intent and
// cut order. The .rd encoder is core code and cannot reach those UI checks,
// so every .rd route (Save .rd on the window or the worker, and the Ruida
// network job) encodes through this one function and gets the same list.

import { emitPreparedRdFile, type EmitRdOptions, type EmitRdResult } from '../../io/rd';
import type { PreparedOutput } from '../../io/gcode';
import { detectMachineJobWarnings } from './machine-job-warnings';

export function emitPreparedRdWithJobWarnings(
  prepared: PreparedOutput,
  options: EmitRdOptions = {},
): EmitRdResult {
  const result = emitPreparedRdFile(prepared, options);
  if (!result.ok || !prepared.ok) return result;
  const jobWarnings = detectMachineJobWarnings(prepared.project, null, null, prepared);
  return jobWarnings.length === 0 ? result : { ...result, jobWarnings };
}
