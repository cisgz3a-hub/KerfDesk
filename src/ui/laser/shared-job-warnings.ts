// The job warnings every output route shows (ADR-705 Amendment 7, C2
// verification E2-P3-2). Save G-code and G-code Start add
// detectMachineJobWarnings to their output: compile diagnostics ("will NOT be
// cut", a kerf side assumed), job intent and cut order. The controller routes
// (.rd, .egv, Moshiboard) are core code and cannot reach those UI checks, so
// each adds them here. The result is a branded list that only this function
// makes: a link job (link-job-outcome.ts) takes one, so a route that skips the
// warnings does not compile.

import type { PreparedOutput } from '../../io/gcode';
import { detectMachineJobWarnings } from './machine-job-warnings';

declare const sharedJobWarningsBrand: unique symbol;

/** detectMachineJobWarnings for a prepared job, plus a route's own job checks. */
export type SharedJobWarnings = ReadonlyArray<string> & {
  readonly [sharedJobWarningsBrand]: true;
};

type PreparedOk = Extract<PreparedOutput, { readonly ok: true }>;

export function sharedJobWarnings(
  prepared: PreparedOk,
  routeChecks: ReadonlyArray<string> = [],
): SharedJobWarnings {
  const warnings = [
    ...detectMachineJobWarnings(prepared.project, null, null, prepared),
    ...routeChecks,
  ];
  return warnings as ReadonlyArray<string> as SharedJobWarnings;
}
