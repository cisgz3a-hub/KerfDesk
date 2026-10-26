// Where a CNC program parks and how high it lifts first (H.9, ADR-392,
// ADR-491). The emitter writes these moves and the preview draws the same
// ones (ADR-491 Amendment 2), so both read them from here.

import type { CncGroup } from '../job/job';
import type { Vec2 } from '../scene';

// H.9 parking parity: the configured park position wins; without one, a
// current-position job parks back at its own start (the finish position the
// emit seam resolved), and everything else keeps the machine-origin default.
// Work zero on a no-homing machine is just the power-on point, so parking a
// head-relative job at X0 Y0 rapids blindly back across the bed — operators
// read that as an uncommanded homing move.
export function parkTarget(group: CncGroup | undefined, finish: Vec2 | undefined): Vec2 {
  return {
    x: group?.parkXMm ?? finish?.x ?? 0,
    y: group?.parkYMm ?? finish?.y ?? 0,
  };
}

// ADR-491: the height the bit lifts to before a park move, never below the
// job's safe Z. Without a park height it is the safe Z, as it always was.
export function parkHeightMm(group: CncGroup | undefined, maxSafeZMm: number): number {
  const parkZMm = group?.parkZMm;
  return parkZMm !== undefined && Number.isFinite(parkZMm)
    ? Math.max(maxSafeZMm, parkZMm)
    : maxSafeZMm;
}
