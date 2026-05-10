/**
 * T1-127: pure parser for GRBL `[G54:x,y,z]` WCS-offset lines.
 * Third slice of the audit's Sprint 4 "extract pure parsers first"
 * sequence (T1-124 status-report, T1-126 settings, T1-127 WCS).
 *
 * Pre-T1-127 the parser lived as `_tryParseG54WcsLine` in
 * `GrblController` plus a top-level `GRBL_G54_WCS_LINE` regex
 * constant. Tiny — but the audit's pattern is "every parsing rule
 * gets a pure module so the controller's interpretation logic is
 * fully testable in isolation, and a future second-controller
 * adapter (Sprint 4 #3) can reuse the parsers without inheriting
 * from the controller class." This module completes that for
 * `$#` work-offset query responses.
 *
 * Exports:
 *   `parseGrblG54WcsLine(line) → { x, y, z } | null`
 *
 * Returns null when the line doesn't match the `[G54:...]` shape OR
 * when any coordinate fails the finite-number check (preserves the
 * pre-T1-127 inline gate exactly — T1-117 documented why this gate
 * matters: a malformed `[G54:bad,bad,bad]` response leaves the
 * controller's `_currentG54` as null which the WCS-fail-closed path
 * surfaces as `'malformed_g54'`).
 */

const GRBL_G54_WCS_LINE = /^\[G54:([^,]+),([^,]+),([^\]]+)\]$/;

export interface ParsedGrblWcs {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Match a `[G54:x,y,z]` line and split into floats. Returns null
 * when:
 *   - the line doesn't match the expected shape (any other GRBL
 *     response, including the trailing `ok`, the wrapping `[…]`
 *     responses for non-G54 work coordinates, or unrelated text)
 *   - one or more coordinates parse to a non-finite number (NaN
 *     from `bad`, `Infinity` from `1e9999`, etc.). T1-117's
 *     fail-closed WCS path treats null as `'malformed_g54'` so
 *     keeping the gate strict is load-bearing for safety.
 */
export function parseGrblG54WcsLine(line: string): ParsedGrblWcs | null {
  const m = line.match(GRBL_G54_WCS_LINE);
  if (!m) return null;
  const x = parseFloat(m[1]);
  const y = parseFloat(m[2]);
  const z = parseFloat(m[3]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return { x, y, z };
}
