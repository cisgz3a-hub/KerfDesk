/**
 * Falcon A1 Pro WiFi state enums.
 *
 * Derived from Wireshark capture of FDS (Falcon Design Space) traffic plus
 * confirmed end-to-end with the `falcon-wifi-probe-v3.mjs` prototype.
 * These numbers appear in two places:
 *   - HTTP GET /work/state  -> { payload: { state: <n> } }
 *   - WebSocket             -> { module: 'printer', curState: <n> }
 */

export const FALCON_STATE = {
  IDLE: 2,
  RUNNING: 8,
  S32: 32,
  FRAMING: 64,
  TRANSIT: 256,
  S512: 512,
} as const;

export type FalconStateNumber = (typeof FALCON_STATE)[keyof typeof FALCON_STATE];

/** Display name mapping for the state enum; unknown values are rendered as UNK(n). */
export const FALCON_STATE_NAMES: Record<number, string> = {
  [FALCON_STATE.IDLE]: 'IDLE',
  [FALCON_STATE.RUNNING]: 'RUNNING',
  [FALCON_STATE.S32]: 'S32',
  [FALCON_STATE.FRAMING]: 'FRAMING',
  [FALCON_STATE.TRANSIT]: 'TRANSIT',
  [FALCON_STATE.S512]: 'S512',
};

export function falconStateName(n: number | null | undefined): string {
  if (n == null) return 'UNKNOWN';
  return FALCON_STATE_NAMES[n] ?? `UNK(${n})`;
}

/** Safe-door curState values from `{ module: 'safeDoor' }` events. */
export const SAFE_DOOR = { CLOSED: 0, OPEN: 1 } as const;

/**
 * Alarm codes observed so far. `type === 0` are heartbeats/acks (ignore);
 * `type === 1` are warnings to surface to the user.
 */
export const FALCON_ALARM_CODES: Record<string, string> = {
  '01000000': 'heartbeat',
  '01002002': 'safety door opened',
};

export function falconAlarmDescription(code: string | null | undefined): string {
  if (!code) return 'Unknown alarm';
  const known = FALCON_ALARM_CODES[code];
  return known ? `${known} (${code})` : `Alarm ${code}`;
}
