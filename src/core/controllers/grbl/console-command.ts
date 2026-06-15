import { CMD_BUILD_INFO, CMD_SETTINGS, CMD_UNLOCK, RT_STATUS } from './commands';

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
};

export type ConsoleCommandResult =
  | { readonly ok: true; readonly command: PreparedConsoleCommand }
  | { readonly ok: false; readonly reason: string };

const EMPTY_REASON = 'Enter one GRBL or G-code command.';
const MULTILINE_REASON =
  'Console commands must be one line. Use macros later for multi-line commands.';
const BLOCKED_PERSISTENT_REASON =
  'This persistent controller command is blocked in the Console. Back up settings and use Machine Settings in a later lane.';

const SETTING_WRITE_RE = /^\$\d+=\S.*$/;
const STARTUP_WRITE_RE = /^\$N\d*=/i;
const BUILD_INFO_WRITE_RE = /^\$I=/i;

export function prepareConsoleCommand(input: string): ConsoleCommandResult {
  const normalized = input.trim();
  if (normalized === '') return { ok: false, reason: EMPTY_REASON };
  if (/[\r\n]/.test(normalized)) return { ok: false, reason: MULTILINE_REASON };
  const upper = normalized.toUpperCase();
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
  if (upper === CMD_UNLOCK) return ok('unlock', CMD_UNLOCK, `${CMD_UNLOCK}\n`);
  if (SETTING_WRITE_RE.test(normalized)) {
    return ok('setting-write', normalized, `${normalized}\n`, true, true, true);
  }
  return ok('gcode', normalized, `${normalized}\n`, true, true, false);
}

function ok(
  kind: ConsoleCommandKind,
  normalized: string,
  wire: string,
  requiresIdle = false,
  requiresNoActiveOperation = true,
  requiresConfirmation = false,
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
    },
  };
}

function isBlockedPersistentCommand(upper: string): boolean {
  return (
    upper === '$RST=*' ||
    upper === '$RST=$' ||
    upper === '$RST=#' ||
    STARTUP_WRITE_RE.test(upper) ||
    BUILD_INFO_WRITE_RE.test(upper)
  );
}
