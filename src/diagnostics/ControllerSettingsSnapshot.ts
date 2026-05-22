/**
 * T2-110: capture the controller's GRBL settings ($$ + $I + $G + $#)
 * before each job runs. Pre-T2-110 the codebase parsed only $30
 * (max spindle) and $32 (laser mode) live; the full settings dump
 * was never persisted. When a job produces wrong output, support's
 * first questions are usually "what's your $30?" "what's your $32?"
 * "where is work-zero?" — and the user has to type these into a chat.
 *
 * Audit 5C Critical 7 + Required Priority 4 calls for the snapshot
 * to be embedded in `JobLog.machine.settings` (T2-109). T2-110 ships
 * the type + the parsers; threading the capture call into
 * `MachineService.startValidatedJob` is filed as T2-110-followup.
 *
 * The parsers are defensive — older GRBL forks emit $I as a single
 * line, $G as a single line, and $$ as one line per setting. If a
 * query times out or returns malformed data, the field is left null
 * so the snapshot still serialises cleanly.
 */

export interface WcsOffset {
  x: number;
  y: number;
  z?: number;
}

export interface ControllerSettingsSnapshot {
  /** ISO 8601 wall clock at capture time. */
  capturedAt: string;
  /** Raw `$I` response, e.g. `[VER:1.1h.20190825:]\n[OPT:VL,15,128]`. Null on failure. */
  buildInfo: string | null;
  /** Raw `$G` parser-state response, e.g. `[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]`. Null on failure. */
  parserState: string | null;
  /** Parsed `$#` work-coordinate offsets. Empty when unavailable. */
  wcsOffsets: Record<string, WcsOffset>;
  /** Parsed `$$` settings. Map of `$<n>` → raw string value. Empty when unavailable. */
  settings: Record<string, string>;
}

const GRBL_SETTING_LINE = /^\$(\d+)=(.+)$/;
const WCS_LINE = /^\[(G54|G55|G56|G57|G58|G59|G28|G30|G92|TLO|PRB):([^\]]+)\]$/;

/**
 * Parse a multi-line `$$` response into a record. Each setting line
 * looks like `$30=1000`. Lines that don't match are silently
 * skipped (so the parser is defensive against `ok` interleaved with
 * settings, GRBL fork extensions, etc).
 */
export function parseDollarDollar(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text) return out;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(GRBL_SETTING_LINE);
    if (!m) continue;
    out[`$${m[1]}`] = m[2].trim();
  }
  return out;
}

/**
 * Parse a `$#` response into a per-system offset record. GRBL emits
 * one bracketed line per coordinate system; coordinates are comma-
 * separated decimals.
 *
 * Example input:
 *   [G54:0.000,0.000,0.000]
 *   [G55:100.000,0.000,0.000]
 *   [TLO:0.000]
 *   [PRB:0.000,0.000,0.000:0]
 */
export function parseWcsOffsets(text: string): Record<string, WcsOffset> {
  const out: Record<string, WcsOffset> = {};
  if (!text) return out;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(WCS_LINE);
    if (!m) continue;
    const key = m[1];
    const parts = m[2].split(':')[0].split(',').map((s) => parseFloat(s.trim()));
    if (parts.length === 0 || !Number.isFinite(parts[0])) continue;
    // TLO is a single-axis offset; keep just .x
    if (key === 'TLO') {
      out[key] = { x: parts[0], y: 0 };
      continue;
    }
    if (parts.length === 2 && Number.isFinite(parts[1])) {
      out[key] = { x: parts[0], y: parts[1] };
    } else if (parts.length >= 3 && [parts[0], parts[1], parts[2]].every(Number.isFinite)) {
      out[key] = { x: parts[0], y: parts[1], z: parts[2] };
    }
  }
  return out;
}

/**
 * Args for the snapshot builder. Each raw response is optional —
 * if a query times out, just pass null and the snapshot leaves that
 * field null (or empty for the parsed map) without throwing.
 */
export interface SnapshotInputs {
  buildInfoRaw: string | null;
  parserStateRaw: string | null;
  wcsOffsetsRaw: string | null;
  dollarDollarRaw: string | null;
  /** Override clock for tests. Defaults to `new Date().toISOString()`. */
  capturedAt?: string;
}

export function buildControllerSettingsSnapshot(args: SnapshotInputs): ControllerSettingsSnapshot {
  return {
    capturedAt: args.capturedAt ?? new Date().toISOString(),
    buildInfo: args.buildInfoRaw == null || args.buildInfoRaw.trim() === '' ? null : args.buildInfoRaw.trim(),
    parserState: args.parserStateRaw == null || args.parserStateRaw.trim() === '' ? null : args.parserStateRaw.trim(),
    wcsOffsets: args.wcsOffsetsRaw == null ? {} : parseWcsOffsets(args.wcsOffsetsRaw),
    settings: args.dollarDollarRaw == null ? {} : parseDollarDollar(args.dollarDollarRaw),
  };
}

/**
 * Convenience: read the safety-relevant subset out of a snapshot.
 * Returns null when the corresponding $$ field is missing — caller
 * must decide whether to refuse the job or fall back to the device
 * profile's declared value.
 */
export function safetyRelevantValues(snap: ControllerSettingsSnapshot): {
  softLimitsEnabled: boolean | null;
  homingEnabled: boolean | null;
  maxSpindle: number | null;
  minSpindle: number | null;
  laserMode: boolean | null;
  bedWidth: number | null;
  bedHeight: number | null;
  zTravelMm: number | null;
} {
  const num = (k: string): number | null => {
    const v = snap.settings[k];
    if (v == null) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const nonNegative = (k: string): number | null => {
    const n = num(k);
    return n != null && n >= 0 ? n : null;
  };
  const positive = (k: string): number | null => {
    const n = num(k);
    return n != null && n > 0 ? n : null;
  };
  const bool = (k: string): boolean | null => {
    const v = snap.settings[k];
    if (v == null) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n !== 0 : null;
  };
  const laser = snap.settings['$32'];
  return {
    softLimitsEnabled: bool('$20'),
    homingEnabled: bool('$22'),
    maxSpindle: positive('$30'),
    minSpindle: nonNegative('$31'),
    laserMode: laser == null ? null : bool('$32'),
    bedWidth: positive('$130'),
    bedHeight: positive('$131'),
    zTravelMm: positive('$132'),
  };
}
