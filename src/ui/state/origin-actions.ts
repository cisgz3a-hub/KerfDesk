// Phase F.3 — set-work-origin action surface. Sibling module to
// autofocus-action.ts / detected-settings-action.ts. Owns the two GRBL
// command writes the laser-store exposes ("Set origin here" / "Reset
// origin") plus the pure `hasCustomOrigin` predicate the UI uses to
// decide whether the Reset button is enabled.
//
// Design (per ADR-021):
//   - G92 is the default. Transient, session-scoped. GRBL auto-clears on alarm /
//     soft-reset / power-cycle. Matches LightBurn / LaserGRBL UX.
//   - Advanced persistent origin uses G10 L20/L2 P1 against G54 and requires
//     Idle before writing controller coordinate storage.
//   - The compile pipeline doesn't change — GRBL applies the offset to
//     our absolute-G90 G-code at run time.
//
// `safeWrite` is the laser-store's bottleneck for serial writes; this
// module receives it as a parameter so the actions stay pure functions
// of their inputs and trivially testable with a mock.

import {
  CMD_CLEAR_ORIGIN,
  CMD_CLEAR_PERSISTENT_ORIGIN,
  CMD_SET_ORIGIN_HERE,
  CMD_SET_PERSISTENT_ORIGIN_HERE,
  CMD_SLEEP,
  CMD_ZERO_Z_HERE,
} from '../../core/controllers/grbl';

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
 * Send `G92 Z0` to declare the current bit height as work Z0 (CNC stock-top
 * zeroing). Leaves any X/Y work origin untouched — GRBL applies G92 offsets
 * per axis.
 */
export async function zeroZHere(safeWrite: (line: string) => Promise<void>): Promise<void> {
  await safeWrite(`${CMD_ZERO_Z_HERE}\n`);
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
 * Advanced persistent-origin flow. Clear any transient G92 offset first so the
 * G54 write records the current physical head position directly.
 */
export async function setPersistentOriginHere(
  safeWrite: (line: string) => Promise<void>,
  onTransientOriginCleared?: () => void,
): Promise<void> {
  await safeWrite(`${CMD_CLEAR_ORIGIN}\n`);
  onTransientOriginCleared?.();
  await safeWrite(`${CMD_SET_PERSISTENT_ORIGIN_HERE}\n`);
}

/**
 * Clear both transient G92 and stored G54 origin state. The G10 L2 form writes
 * the G54 offset explicitly back to machine zero.
 */
export async function clearPersistentOrigin(
  safeWrite: (line: string) => Promise<void>,
  onTransientOriginCleared?: () => void,
): Promise<void> {
  await safeWrite(`${CMD_CLEAR_ORIGIN}\n`);
  onTransientOriginCleared?.();
  await safeWrite(`${CMD_CLEAR_PERSISTENT_ORIGIN}\n`);
}

/**
 * Send `$SLP` to put GRBL to sleep, de-energizing the steppers so the operator
 * can push the gantry by hand (ADR-053 P4). The controller then ignores commands
 * until a soft-reset, which clears the G92 origin — so the store action that
 * wraps this also drops the cached origin and any Verified Frame, and the
 * operator must Set origin again after waking.
 */
export async function releaseMotors(safeWrite: (line: string) => Promise<void>): Promise<void> {
  await safeWrite(`${CMD_SLEEP}\n`);
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
