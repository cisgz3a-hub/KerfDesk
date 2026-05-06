/**
 * T2-113: structured RX/TX entries — line numbers, buffer state,
 * classification. Pre-T2-113 entries at `MachineService.ts:215-227`
 * were stored as `{ timestamp, type: 'sent'|'received', message: string }`
 * where `message` is a flat formatted string. Audit 5C calls out the
 * lost-information cost: controller line number, command type
 * classification, response correlation, buffer state at send,
 * timestamp deltas — all baked into the message string and
 * regex-parsed by every consumer.
 *
 * T2-113 ships the structured shape + the classifier helpers + the
 * correlation tracker. Migrating MachineService capture sites to
 * emit structured entries is filed as T2-113-followup since it
 * touches every TX/RX site; pairs with T2-104 user-data migration
 * for backward-compat with legacy `{message}` logs.
 */

export type EntryDirection = 'tx' | 'rx';

export type EntrySource = 'job' | 'user' | 'system' | 'internal';

export type CommandType =
  | 'motion'      // G0 / G1 / G2 / G3
  | 'mcode'       // M3 / M4 / M5 / M30 / etc.
  | 'system'      // $$, $#, $G, $H, $X, $J=
  | 'status'      // ?, $#
  | 'realtime'    // single-byte realtime command (~, !, 0x18, 0x84, etc.)
  | 'comment'     // ; ... or (...)
  | 'unknown';

export type ResponseClassification =
  | 'ok'
  | 'error'       // error:N
  | 'alarm'       // ALARM:N
  | 'status'      // <Idle|MPos:0,0,0|...> realtime status
  | 'welcome'     // 'Grbl 1.1h ['$' for help]'
  | 'feedback'    // [GC:...], [G54:...], [VER:...], [OPT:...]
  | 'unknown';

/**
 * The structured classification block. All fields are optional so
 * legacy `{message}` entries stay readable (nullish classification).
 */
export interface EntryClassification {
  direction: EntryDirection;
  source: EntrySource;
  commandType?: CommandType;
  responseClass?: ResponseClassification;
  /** GRBL's running line counter (Ln field of status reports). */
  controllerLineNumber?: number;
  /** Index of the TX entry this RX responds to. */
  responseTo?: number;
  /** RX bytecode for `error:N` / `alarm:N` numeric value. */
  errorCode?: number;
  alarmCode?: number;
  /** Buffer state observed AT/AFTER this entry. */
  bufferStateAfter?: { freeChars: number; queueDepth: number };
}

export interface StructuredJobLogEntry {
  timestamp: number;
  type: 'info' | 'sent' | 'received' | 'error' | 'warning' | 'milestone';
  /** Wire-format raw line (sent/received only). */
  raw?: string;
  classification?: EntryClassification;
  /** Error metadata for `type==='error'` / `'warning'`. */
  error?: { code?: string; message: string; stack?: string };
  /** Human-readable summary; legacy field — derive from raw + classification. */
  message: string;
}

// ─── classifiers ───────────────────────────────────────────

const SYSTEM_CMD_RE = /^\$/;
const STATUS_QUERY_RE = /^\?$/;
const REALTIME_BYTE_RE = /^[\x18\x84\x85\x90\x91\x92\x93\x94\x95\x96\x97\x99\xA1!~?]$/;
const G_MOTION_RE = /\bG(?:0|1|2|3)\b/i;
const M_CODE_RE = /\bM\d+/i;
const COMMENT_RE = /^[;(]/;

export function classifyCommand(raw: string): CommandType {
  const trimmed = raw.trim();
  if (trimmed === '') return 'unknown';
  // STATUS_QUERY ('?') wins over REALTIME so user-facing status
  // queries surface as their distinct kind rather than as a generic
  // realtime byte.
  if (STATUS_QUERY_RE.test(trimmed)) return 'status';
  if (REALTIME_BYTE_RE.test(trimmed) && trimmed.length === 1) return 'realtime';
  if (SYSTEM_CMD_RE.test(trimmed)) return 'system';
  if (COMMENT_RE.test(trimmed)) return 'comment';
  if (G_MOTION_RE.test(trimmed)) return 'motion';
  if (M_CODE_RE.test(trimmed)) return 'mcode';
  return 'unknown';
}

const ERROR_RE = /^error:(\d+)/i;
const ALARM_RE = /^ALARM:(\d+)/i;
const STATUS_REPORT_RE = /^<.*>$/;
const WELCOME_RE = /^Grbl\s/i;
const FEEDBACK_RE = /^\[/;

export function classifyResponse(raw: string): {
  responseClass: ResponseClassification;
  errorCode?: number;
  alarmCode?: number;
} {
  const trimmed = raw.trim();
  if (trimmed === 'ok') return { responseClass: 'ok' };
  const errMatch = trimmed.match(ERROR_RE);
  if (errMatch) {
    return { responseClass: 'error', errorCode: parseInt(errMatch[1], 10) };
  }
  const alarmMatch = trimmed.match(ALARM_RE);
  if (alarmMatch) {
    return { responseClass: 'alarm', alarmCode: parseInt(alarmMatch[1], 10) };
  }
  if (STATUS_REPORT_RE.test(trimmed)) return { responseClass: 'status' };
  if (WELCOME_RE.test(trimmed)) return { responseClass: 'welcome' };
  if (FEEDBACK_RE.test(trimmed)) return { responseClass: 'feedback' };
  return { responseClass: 'unknown' };
}

// ─── builders ──────────────────────────────────────────────

export interface BuildTxEntryArgs {
  timestamp: number;
  raw: string;
  source: EntrySource;
  bufferStateAfter?: { freeChars: number; queueDepth: number };
}

export function buildTxEntry(args: BuildTxEntryArgs): StructuredJobLogEntry {
  const commandType = classifyCommand(args.raw);
  return {
    timestamp: args.timestamp,
    type: 'sent',
    raw: args.raw,
    classification: {
      direction: 'tx',
      source: args.source,
      commandType,
      bufferStateAfter: args.bufferStateAfter,
    },
    message: `→ ${args.raw}`,
  };
}

export interface BuildRxEntryArgs {
  timestamp: number;
  raw: string;
  responseTo?: number;
  controllerLineNumber?: number;
  bufferStateAfter?: { freeChars: number; queueDepth: number };
}

export function buildRxEntry(args: BuildRxEntryArgs): StructuredJobLogEntry {
  const cls = classifyResponse(args.raw);
  return {
    timestamp: args.timestamp,
    type: 'received',
    raw: args.raw,
    classification: {
      direction: 'rx',
      source: 'system',
      responseClass: cls.responseClass,
      errorCode: cls.errorCode,
      alarmCode: cls.alarmCode,
      controllerLineNumber: args.controllerLineNumber,
      responseTo: args.responseTo,
      bufferStateAfter: args.bufferStateAfter,
    },
    message: `← ${args.raw}`,
  };
}

/**
 * Backward-compat: convert a legacy `{ timestamp, type, message }`
 * entry to the structured shape. The `message` field is preserved
 * verbatim; classification is derived from the message when
 * possible.
 */
export interface LegacyEntry {
  timestamp: number;
  type: 'info' | 'sent' | 'received' | 'error' | 'warning' | 'milestone';
  message: string;
}

export function fromLegacyEntry(legacy: LegacyEntry): StructuredJobLogEntry {
  if (legacy.type === 'sent') {
    // Legacy "sent" messages often have a "→ " or "→" prefix; strip
    const raw = legacy.message.replace(/^→\s*/, '').trim();
    return buildTxEntry({
      timestamp: legacy.timestamp, raw,
      source: 'system', // legacy entries don't preserve the originator
    });
  }
  if (legacy.type === 'received') {
    const raw = legacy.message.replace(/^←\s*/, '').trim();
    return buildRxEntry({ timestamp: legacy.timestamp, raw });
  }
  return {
    timestamp: legacy.timestamp,
    type: legacy.type,
    message: legacy.message,
  };
}

// ─── correlation tracker ───────────────────────────────────

/**
 * Pairs RX entries with their preceding TX entry. The simple model:
 * every `ok` / `error:N` response pairs with the LAST tx-entry whose
 * commandType is `motion`, `mcode`, or `system`. Status reports and
 * realtime acks don't correlate (they're sourced asynchronously).
 *
 * The tracker is stateful — feed entries in chronological order;
 * call `correlate(rxEntry)` to get back the responseTo index.
 */
export class RxTxCorrelator {
  private pendingTx: number[] = [];

  recordTx(index: number, entry: StructuredJobLogEntry): void {
    if (entry.classification?.direction !== 'tx') return;
    const cmd = entry.classification.commandType;
    if (cmd === 'motion' || cmd === 'mcode' || cmd === 'system') {
      this.pendingTx.push(index);
    }
  }

  correlateRx(entry: StructuredJobLogEntry): number | undefined {
    if (entry.classification?.direction !== 'rx') return undefined;
    const cls = entry.classification.responseClass;
    // Only ok / error / alarm correlate; status / welcome / feedback don't.
    if (cls !== 'ok' && cls !== 'error' && cls !== 'alarm') return undefined;
    return this.pendingTx.shift();
  }

  reset(): void {
    this.pendingTx = [];
  }

  get pendingCount(): number {
    return this.pendingTx.length;
  }
}
