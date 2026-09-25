import { CMD_BUILD_INFO, CMD_SETTINGS, CMD_UNLOCK, RT_RESUME, RT_STATUS } from './commands';
import { commonConsoleStateEffect, type ConsoleStateEffect } from '../console-state-effect';
import { consoleTextRefusal, normalizeConsoleSpaces } from '../console-text';

export const CMD_OFFSETS = '$#';
export const CMD_MODAL_STATE = '$G';

export type ConsoleCommandKind =
  | 'realtime-status'
  | 'realtime-cycle-start'
  | 'check-mode'
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
  /** Controller states the firmware accepts this `$` command in, when that is
   * not Idle alone. GRBL's system.c takes `$C` in Idle or Check mode (the second
   * `$C` is the documented way out of Check) and `$H`/`$SLP` in Idle or Alarm. */
  readonly allowedStates?: ReadonlyArray<string>;
};

export type ConsoleCommandResult =
  | { readonly ok: true; readonly command: PreparedConsoleCommand }
  | { readonly ok: false; readonly reason: string };

const EMPTY_REASON = 'Enter one GRBL or G-code command.';
const MULTILINE_REASON = 'Console commands and saved macros must contain exactly one line.';
const BLOCKED_PERSISTENT_REASON =
  'This persistent controller command is blocked in the Console. Back up settings and use Machine Settings in a later lane.';

// GRBL-family firmware executes these bytes the moment they arrive, anywhere
// in the stream and even inside a comment (gnea/grbl serial.c ISR; grblHAL's
// legacy realtime characters; FluidNC Channel::pollLine). A `!` inside a line
// holds the controller before the line is parsed, so no `ok` ever comes and
// the exchange wedges until a cycle start (audit GP-3).
const FEED_HOLD_REASON =
  '"!" is the controller\'s feed-hold command: it acts the moment it arrives, even inside a comment, and holds the machine before this line runs. Remove it (use Pause on the machine rail to hold a job).';
const CYCLE_START_REASON =
  '"~" is the controller\'s cycle-start command: it acts the moment it arrives, even inside a comment. Send "~" on its own to resume a hold, or remove it from the line.';
const STATUS_QUERY_REASON =
  '"?" is the controller\'s status query: it acts the moment it arrives, even inside a comment, and is removed from the line. Send "?" on its own, or remove it from the line.';
const CMD_CHECK_MODE = '$C';
const HOME_OR_SLEEP_RE = /^\$(?:H[XYZABC]?|SLP)$/i;
const IDLE_OR_ALARM: ReadonlyArray<string> = ['Idle', 'Alarm'];
const IDLE_OR_CHECK: ReadonlyArray<string> = ['Idle', 'Check'];

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
  const realtime = prepareRealtimeCommand(normalized);
  if (realtime !== null) return realtime;
  const systemCommand = prepareSystemCommand(upper);
  if (systemCommand !== null) return systemCommand;
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
  if (HOME_OR_SLEEP_RE.test(compact)) {
    const stateEffect = /^\$SLP$/i.test(compact) ? 'machine-state' : 'reference';
    return ok('gcode', compact, `${compact}\n`, false, true, false, stateEffect, IDLE_OR_ALARM);
  }
  const stateEffect = commonConsoleStateEffect(compact);
  return ok('gcode', normalized, `${normalized}\n`, true, true, false, stateEffect);
}

// `?` alone is the status query and `~` alone the cycle start; any of the
// realtime characters inside a longer line is refused (audit GP-3).
function prepareRealtimeCommand(normalized: string): ConsoleCommandResult | null {
  if (normalized === RT_STATUS) {
    return ok('realtime-status', normalized, RT_STATUS, false, false, false);
  }
  if (normalized === RT_RESUME) {
    // A lone `~` resumes a hold outside a job (a `!` or a door the operator
    // closed). It owes no acknowledgement; a job is resumed from the rail.
    return ok('realtime-cycle-start', normalized, RT_RESUME, false, true, false);
  }
  const refusal = embeddedRealtimeRefusal(normalized);
  return refusal === null ? null : { ok: false, reason: refusal };
}

function prepareSystemCommand(upper: string): ConsoleCommandResult | null {
  switch (upper) {
    case CMD_SETTINGS:
      return ok('settings-query', CMD_SETTINGS, `${CMD_SETTINGS}\n`);
    case CMD_OFFSETS:
      return ok('offset-query', CMD_OFFSETS, `${CMD_OFFSETS}\n`);
    case CMD_BUILD_INFO:
      return ok('build-info-query', CMD_BUILD_INFO, `${CMD_BUILD_INFO}\n`);
    case CMD_MODAL_STATE:
      return ok('modal-state-query', CMD_MODAL_STATE, `${CMD_MODAL_STATE}\n`);
    case CMD_UNLOCK:
      return ok('unlock', CMD_UNLOCK, `${CMD_UNLOCK}\n`, false, true, false, 'machine-state');
    case CMD_CHECK_MODE:
      return ok(
        'check-mode',
        CMD_CHECK_MODE,
        `${CMD_CHECK_MODE}\n`,
        false,
        true,
        false,
        'machine-state',
        IDLE_OR_CHECK,
      );
    default:
      return null;
  }
}

function embeddedRealtimeRefusal(line: string): string | null {
  if (line.includes('!')) return FEED_HOLD_REASON;
  if (line.includes('~')) return CYCLE_START_REASON;
  if (line.includes(RT_STATUS)) return STATUS_QUERY_REASON;
  return null;
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
  allowedStates?: ReadonlyArray<string>,
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
      ...(allowedStates === undefined ? {} : { allowedStates }),
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
