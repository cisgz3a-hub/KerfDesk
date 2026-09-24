import { CMD_BUILD_INFO, CMD_SETTINGS, CMD_UNLOCK, RT_STATUS } from './commands';
import { commonConsoleStateEffect, type ConsoleStateEffect } from '../console-state-effect';
import { consoleTextRefusal, normalizeConsoleSpaces } from '../console-text';

export const CMD_OFFSETS = '$#';
export const CMD_MODAL_STATE = '$G';

export type ConsoleCommandKind =
  | 'realtime-status'
  | 'settings-query'
  | 'offset-query'
  | 'build-info-query'
  | 'modal-state-query'
  | 'unlock'
  | 'setting-write'
  | 'gcode';

export type PreparedConsoleCommand = {
  readonly kind: ConsoleCommandKind;
  readonly normalized: string;
  readonly wire: string;
  readonly requiresIdle: boolean;
  readonly requiresNoActiveOperation: boolean;
  readonly requiresConfirmation: boolean;
  readonly stateEffect: ConsoleStateEffect;
};

export type ConsoleCommandResult =
  | { readonly ok: true; readonly command: PreparedConsoleCommand }
  | { readonly ok: false; readonly reason: string };

const EMPTY_REASON = 'Enter one GRBL or G-code command.';
const MULTILINE_REASON = 'Console commands and saved macros must contain exactly one line.';
const BLOCKED_PERSISTENT_REASON =
  'This persistent controller command is blocked in the Console. Back up settings and use Machine Settings in a later lane.';

const SETTING_WRITE_RE = /^\$\d+=\S.*$/;
const STARTUP_WRITE_RE = /^\$N\d*=/i;
const BUILD_INFO_WRITE_RE = /^\$I=/i;
const POSITION_AFFECTING_SETTING_IDS: ReadonlyArray<number> = [
  2, 3, 20, 22, 23, 100, 101, 102, 130, 131, 132,
];

export function prepareConsoleCommand(input: string): ConsoleCommandResult {
  const trimmed = normalizeConsoleSpaces(input).trim();
  const lineRefusal = consoleLineRefusal(trimmed);
  if (lineRefusal !== null) return { ok: false, reason: lineRefusal };
  // GRBL discards horizontal whitespace while parsing `$` system commands.
  // Classify the fully compact form so spaces cannot disguise a persistent
  // write/reset as ordinary G-code and bypass its safety policy; send the
  // canonical form, which keeps a value's interior spaces.
  const normalized = normalizeConsoleInput(trimmed);
  const compact = trimmed.startsWith('$') ? normalized.replaceAll(/[ \t]/g, '') : normalized;
  const upper = compact.toUpperCase();
  if (isBlockedPersistentCommand(upper)) {
    return { ok: false, reason: BLOCKED_PERSISTENT_REASON };
  }
  if (normalized === RT_STATUS) {
    return ok('realtime-status', normalized, RT_STATUS, false, false, false);
  }
  if (upper === CMD_SETTINGS) return ok('settings-query', CMD_SETTINGS, `${CMD_SETTINGS}\n`);
  if (upper === CMD_OFFSETS) return ok('offset-query', CMD_OFFSETS, `${CMD_OFFSETS}\n`);
  if (upper === CMD_BUILD_INFO) {
    return ok('build-info-query', CMD_BUILD_INFO, `${CMD_BUILD_INFO}\n`);
  }
  if (upper === CMD_MODAL_STATE) {
    return ok('modal-state-query', CMD_MODAL_STATE, `${CMD_MODAL_STATE}\n`);
  }
  if (upper === CMD_UNLOCK) {
    return ok('unlock', CMD_UNLOCK, `${CMD_UNLOCK}\n`, false, true, false, 'machine-state');
  }
  if (SETTING_WRITE_RE.test(compact)) {
    return ok(
      'setting-write',
      normalized,
      `${normalized}\n`,
      true,
      true,
      true,
      settingWriteStateEffect(compact),
    );
  }
  const stateEffect = /^\$H(?:[XYZABC])?$/i.test(compact)
    ? 'reference'
    : commonConsoleStateEffect(compact);
  return ok('gcode', normalized, `${normalized}\n`, true, true, false, stateEffect);
}

function consoleLineRefusal(trimmed: string): string | null {
  if (trimmed === '') return EMPTY_REASON;
  if (/[\r\n]/.test(trimmed)) return MULTILINE_REASON;
  return consoleTextRefusal(trimmed);
}

// The canonical `$` line: the command and key up to the first '=' compacted the
// way GRBL-family firmware parses them, whitespace right after '=' dropped, and
// the value kept as typed. Stripping every space corrupted string values:
// grblHAL and FluidNC store interior spaces (`$Sta/SSID=My Home WiFi` became
// `MyHomeWiFi`, `$LocalFS/Run=my job.nc` ran another file), while stock GRBL
// discards them itself (audit settings-console-9).
function normalizeConsoleInput(trimmed: string): string {
  if (!trimmed.startsWith('$')) return trimmed;
  const equals = trimmed.indexOf('=');
  if (equals < 0) return trimmed.replaceAll(/[ \t]/g, '');
  const key = trimmed.slice(0, equals).replaceAll(/[ \t]/g, '');
  const value = trimmed.slice(equals + 1).replace(/^[ \t]+/, '');
  return `${key}=${value}`;
}

function settingWriteStateEffect(normalized: string): ConsoleStateEffect {
  const settingId = Number(/^\$(\d+)=/.exec(normalized)?.[1]);
  return POSITION_AFFECTING_SETTING_IDS.includes(settingId)
    ? 'configuration'
    : 'configuration-nonpositional';
}

function ok(
  kind: ConsoleCommandKind,
  normalized: string,
  wire: string,
  requiresIdle = false,
  requiresNoActiveOperation = true,
  requiresConfirmation = false,
  stateEffect: ConsoleStateEffect = 'read-only',
): ConsoleCommandResult {
  return {
    ok: true,
    command: {
      kind,
      normalized,
      wire,
      requiresIdle,
      requiresNoActiveOperation,
      requiresConfirmation,
      stateEffect,
    },
  };
}

// Every `$RST=` form: GRBL's `*`, `$` and `#` restores, and grblHAL's `&`
// (driver and plugin defaults, which on the Falcon covers the vendor's extended
// settings), which grblHAL dispatches on the first character after '=' so
// trailing text does not make it harmless (audit settings-console-8).
function isBlockedPersistentCommand(upper: string): boolean {
  return /^\$RST=/.test(upper) || STARTUP_WRITE_RE.test(upper) || BUILD_INFO_WRITE_RE.test(upper);
}
