import type { MachineTransformResult } from '../core/plan/MachineTransform';
import type { Move } from '../core/plan/Plan';
import type { AABB } from '../core/types';

/**
 * Display snapshot captured when a validated job starts (from the same
 * `CompileGcodeResult` as the running ticket). Reference-stable for the
 * duration of the job; not updated on recompiles. Lives on MachineService
 * (not on ValidatedJobTicket) so compile preview iterations do not churn
 * array identities attached to the ticket.
 */
export interface ActiveJobCanvasContext {
  readonly canvasMoves: readonly Move[];
  readonly canvasPlanBounds: AABB;
  readonly machineTransform: MachineTransformResult;
}
