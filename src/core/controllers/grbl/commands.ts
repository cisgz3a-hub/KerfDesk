// GRBL v1.1 command vocabulary.
//
// Real-time commands are single bytes (or pairs) that GRBL processes
// instantly without queueing — used for status polling, hold, resume, soft
// reset. They are NOT sent through the character-counted streamer; the host
// writes them directly to the serial port.
//
// Line commands ($H, $X, $J=, $$, $I) are queued like normal G-code but
// dispatched at well-defined moments in the connection lifecycle.

// --- Real-time commands (single byte) ---

/** Status report request. GRBL replies with <state|...>. Poll at ~5 Hz. */
export const RT_STATUS = '?';

/** Cycle start / resume from hold. */
export const RT_RESUME = '~';

/** Feed hold (pause). GRBL transitions into Hold:0 / Hold:1. */
export const RT_HOLD = '!';

/** Soft reset (Ctrl-X = 0x18). Clears alarm, empties planner, no position loss
 *  if already idle. */
export const RT_SOFT_RESET = '\x18';

// --- Line commands ($-prefixed) ---

/** Homing cycle — requires $22=1. */
export const CMD_HOME = '$H';

/** Unlock from alarm — clears $X lock, leaves position unknown until $H. */
export const CMD_UNLOCK = '$X';

/** Sleep — de-energizes the steppers so the gantry can be pushed by hand. GRBL
 *  stays asleep until a soft-reset (Ctrl-X), which also clears the G92 work
 *  origin, so the operator must re-set the origin after waking. The only
 *  portable GRBL v1.1 way to release the motors (no $MD / M18 in stock GRBL). */
export const CMD_SLEEP = '$SLP';

/** Settings dump. */
export const CMD_SETTINGS = '$$';

/** Build info. */
export const CMD_BUILD_INFO = '$I';

/** Coolant / air assist off. Normal queued G-code line, not a realtime byte. */
export const CMD_COOLANT_OFF = 'M9';

// --- Work coordinate offset (Phase F.3 set-work-origin) ---
// GRBL applies a machine-to-work offset on top of the active WCS (G54 by
// default). G92 modifies that offset transiently — it's cleared on alarm,
// soft reset, and `$RST=#`. Persistent equivalent would be G10 L20 P1 X0 Y0
// (sets the G54 offset itself). Per ADR-021 we ship G92 only — matches
// LightBurn / LaserGRBL "Set Job Origin" semantics where the operator
// expects each session to start with a fresh origin.

/** Set work origin to the current head position (transient, cleared on
 *  alarm/soft-reset). Maps to G92 X0 Y0 — declares the current MPos as the
 *  (0, 0) of the work coordinate system. The next G-code job runs relative
 *  to the workpiece corner the operator jogged to. */
export const CMD_SET_ORIGIN_HERE = 'G92 X0 Y0';

/** Clear the G92 offset, returning the work coordinate system to its
 *  underlying G54 origin (typically machine zero). G92.1 zeros the active
 *  offset, G92.2 disables without clearing, G92.3 re-enables; we use .1 so
 *  the operator's next "Set origin here" starts from a clean state. */
export const CMD_CLEAR_ORIGIN = 'G92.1';

// --- Jog command builder ---

export type JogParams = {
  // Distance along each axis in mm (relative). Omit (or 0) for axes that
  // shouldn't move this jog.
  readonly dx?: number;
  readonly dy?: number;
  // Feed rate in mm/min. GRBL requires F for jog commands.
  readonly feed: number;
  // When true, emits a relative-mode jog ($J=G91...). When false, absolute.
  // The vast majority of UI jogs are relative; default true.
  readonly relative?: boolean;
};

/**
 * Build a `$J=` jog command. Per GRBL v1.1 docs, jog commands are streamed
 * like normal G-code but live in a separate motion queue that can be cancelled
 * with the real-time `\x85` byte without affecting the planner.
 */
export function buildJogCommand(params: JogParams): string {
  const parts: string[] = [];
  parts.push(params.relative === false ? 'G90' : 'G91');
  parts.push('G21'); // mm
  if (typeof params.dx === 'number' && params.dx !== 0) {
    parts.push(`X${formatMm(params.dx)}`);
  }
  if (typeof params.dy === 'number' && params.dy !== 0) {
    parts.push(`Y${formatMm(params.dy)}`);
  }
  parts.push(`F${Math.max(1, Math.round(params.feed))}`);
  return `$J=${parts.join(' ')}`;
}

/** Jog-cancel real-time byte (0x85). Aborts the in-flight jog motion only. */
export const RT_JOG_CANCEL = '\x85';

function formatMm(n: number): string {
  return n.toFixed(3);
}
