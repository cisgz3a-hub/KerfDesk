// The single canonical set of preflight codes that may refuse an action.
//
// Rule 7 / ADR-228: a preflight finding may warn, but only a *factual* inability
// to produce the program may refuse. These six are rule-7 category (b) compile
// integrity — the program cannot be materialized at all:
//   - non-finite-coordinate / empty-output: nothing emittable was produced.
//   - cnc-tool-geometry-invalid: V-carve depth cannot be calculated without
//     the selected V-bit's explicit included angle; configured contributing
//     secondary stages must resolve to supported tools; and flat-floor/rest
//     clearing cannot use a non-flat cutter.
//   - no-output-layer: there is no layer to emit from.
//   - relief-needs-cnc: a relief object cannot compile on a laser machine.
//   - program-materialization-failed: the engine factually failed to build the
//     program string (RangeError, ADR-243) — not a predictive size cap.
//
// Every other code is a heuristic policy judgment (out-of-bed, no-go-zone
// collision, plunged travel, speed/power range, settings validity, ...). Those
// inform the operator and never refuse: on Start via the Job Review warnings
// list, on Save as post-save advisories.
//
// This set lives in core so the Start and Save paths cannot drift apart. They
// did: Save previously blocked on an *allowlist of advisories* (only the
// scan-offset magnitude cap), which made every other policy finding refuse
// export while the same finding merely warned on Start.

import type { PreflightCode } from './preflight';

export const COMPILE_INTEGRITY_PREFLIGHT_CODES: ReadonlySet<PreflightCode> = new Set<PreflightCode>(
  [
    'non-finite-coordinate',
    'cnc-tool-geometry-invalid',
    'empty-output',
    'relief-needs-cnc',
    'no-output-layer',
    'program-materialization-failed',
  ],
);
