// Phase F.3 — set-work-origin action surface. Sibling module to
// autofocus-action.ts / detected-settings-action.ts. Owns the two GRBL
// command writes the laser-store exposes ("Set origin here" / "Reset
// origin") plus the pure `hasCustomOrigin` predicate the UI uses to
// decide whether the Reset button is enabled.
//
// Design (per ADR-021):
//   - G92 only. Transient, session-scoped. GRBL auto-clears on alarm /
//     soft-reset / power-cycle. Matches LightBurn / LaserGRBL UX.
//   - No persistent (G10 L20 P1) mode. Deferred until requested.
//   - The compile pipeline doesn't change — GRBL applies the offset to
//     our absolute-G90 G-code at run time.
//
// `safeWrite` is the laser-store's bottleneck for serial writes; this
// module receives it as a parameter so the actions stay pure functions
// of their inputs and trivially testable with a mock.

import { CMD_CLEAR_ORIGIN, CMD_SET_ORIGIN_HERE } from '../../core/controllers/grbl';

/**
 * Threshold for `hasCustomOrigin`. WCO values arrive as decimals from
 * GRBL with at most 3 fractional digits; anything below 1 micron is
 * indistinguishable from "exactly zero" and reflects floating-point
 * artefact rather than a deliberate offset.
 */
const ORIGIN_EPSILON_MM = 1e-3;

export type WorkCoordinateOffset = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/**
 * Send `G92 X0 Y0` to declare the current head position as work-coord
 * origin (0, 0). Doesn't touch the laser-store directly — the store
 * subscribes to incoming status frames and will pick up the resulting
 * WCO on the next WCO-bearing report.
 */
export async function setOriginHere(safeWrite: (line: string) => Promise<void>): Promise<void> {
  await safeWrite(`${CMD_SET_ORIGIN_HERE}\n`);
}

/**
 * Send `G92.1` to clear the active G92 offset, returning the work
 * coordinate system to its underlying G54 origin (typically machine
 * zero). Same reactive update flow as setOriginHere — the cached WCO
 * clears via the next status frame.
 */
export async function resetOrigin(safeWrite: (line: string) => Promise<void>): Promise<void> {
  await safeWrite(`${CMD_CLEAR_ORIGIN}\n`);
}

/**
 * True when the cached WCO is non-trivial — i.e. the operator has set
 * a custom work origin and GRBL is currently applying it. Null cache
 * (no WCO frame received yet) is treated as "no custom origin" — the
 * conservative reading for a fresh connection. Z is included even
 * though laser tools rarely use it, so the predicate is honest about
 * GRBL's actual state.
 */
export function hasCustomOrigin(wco: WorkCoordinateOffset | null): boolean {
  if (wco === null) return false;
  return (
    Math.abs(wco.x) > ORIGIN_EPSILON_MM ||
    Math.abs(wco.y) > ORIGIN_EPSILON_MM ||
    Math.abs(wco.z) > ORIGIN_EPSILON_MM
  );
}
