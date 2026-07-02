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
// soft reset, and `$RST=#`. Advanced persistent-origin controls use
// G10 L20/L2 against G54 when the operator explicitly wants the origin
// to survive reconnects.

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

/** Zero the work Z at the current bit/head height (CNC: touch the bit to the
 *  stock top, then declare that plane Z0 so cut depths measure into the
 *  material). G92 offsets are per-axis in GRBL — this leaves X/Y untouched. */
export const CMD_ZERO_Z_HERE = 'G92 Z0';

/** Set the G54 work coordinate origin to the current head position. Persistent:
 *  this writes controller coordinate storage and survives reset/power-cycle. */
export const CMD_SET_PERSISTENT_ORIGIN_HERE = 'G10 L20 P1 X0 Y0';

/** Clear the stored G54 offset back to machine zero. */
export const CMD_CLEAR_PERSISTENT_ORIGIN = 'G10 L2 P1 X0 Y0';

// --- Jog command builder ---

export type JogParams = {
  // Distance along each axis in mm (relative). Omit (or 0) for axes that
  // shouldn't move this jog.
  readonly dx?: number;
  readonly dy?: number;
  readonly dz?: number;
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
  if (typeof params.dz === 'number' && params.dz !== 0) {
    parts.push(`Z${formatMm(params.dz)}`);
  }
  parts.push(`F${Math.max(1, Math.round(params.feed))}`);
  return `$J=${parts.join(' ')}`;
}

/** Jog-cancel real-time byte (0x85). Aborts the in-flight jog motion only. */
export const RT_JOG_CANCEL = '\x85';

// --- Real-time overrides (ADR-102 G3) ---
// GRBL v1.1 extended real-time bytes: processed instantly mid-job without
// touching the planner queue. Feed clamps to 10–200%, spindle to 10–200%,
// rapid picks from {25, 50, 100}%. The controller reports the live values
// in the status report's `Ov:` field.

export const RT_FEED_OV_RESET = '\x90';
export const RT_FEED_OV_PLUS_10 = '\x91';
export const RT_FEED_OV_MINUS_10 = '\x92';
export const RT_FEED_OV_PLUS_1 = '\x93';
export const RT_FEED_OV_MINUS_1 = '\x94';
export const RT_RAPID_OV_FULL = '\x95';
export const RT_RAPID_OV_HALF = '\x96';
export const RT_RAPID_OV_QUARTER = '\x97';
export const RT_SPINDLE_OV_RESET = '\x99';
export const RT_SPINDLE_OV_PLUS_10 = '\x9a';
export const RT_SPINDLE_OV_MINUS_10 = '\x9b';
export const RT_SPINDLE_OV_PLUS_1 = '\x9c';
export const RT_SPINDLE_OV_MINUS_1 = '\x9d';

export type RealtimeOverrideByte =
  | typeof RT_FEED_OV_RESET
  | typeof RT_FEED_OV_PLUS_10
  | typeof RT_FEED_OV_MINUS_10
  | typeof RT_FEED_OV_PLUS_1
  | typeof RT_FEED_OV_MINUS_1
  | typeof RT_RAPID_OV_FULL
  | typeof RT_RAPID_OV_HALF
  | typeof RT_RAPID_OV_QUARTER
  | typeof RT_SPINDLE_OV_RESET
  | typeof RT_SPINDLE_OV_PLUS_10
  | typeof RT_SPINDLE_OV_MINUS_10
  | typeof RT_SPINDLE_OV_PLUS_1
  | typeof RT_SPINDLE_OV_MINUS_1;

function formatMm(n: number): string {
  return n.toFixed(3);
}
