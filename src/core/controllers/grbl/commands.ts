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

/** Settings dump. */
export const CMD_SETTINGS = '$$';

/** Build info. */
export const CMD_BUILD_INFO = '$I';

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
