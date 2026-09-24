// Console-input validation for Smoothieware. Persistent config writes
// (config-set / config-load) are blocked, matching the GRBL console's
// $RST/$N policy. M999 (halt recovery) is allowed while operations are
// stuck — it is the recovery command.
//
// Every console line owes the controller's terminal reply before the next
// command may go out, so the Console only sends lines whose completion
// Smoothieware actually prints. GcodeDispatch answers every G-code line (and
// `ok - ignored` for other capitalised text), but lines starting with `$` or a
// lowercase letter belong to SimpleShell, which prints `ok` only for $G, $#
// and $H (and $X while halted). `version` and `fire off` have their own
// completion lines (see response.ts). Any other shell line would leave its
// acknowledgement owed and hold Jog, Frame, Home and Start until a reconnect.
// https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/communication/GcodeDispatch.cpp
// https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/utils/simpleshell/SimpleShell.cpp

import type { ConsoleCommandResult } from '../grbl/console-command';
import { commonConsoleStateEffect, type ConsoleStateEffect } from '../console-state-effect';
import { consoleTextRefusal, normalizeConsoleSpaces } from '../console-text';
import {
  SMOOTHIE_CMD_FIRE_OFF,
  SMOOTHIE_CMD_FIRMWARE_INFO,
  SMOOTHIE_CMD_HOME,
  SMOOTHIE_CMD_POSITION,
  SMOOTHIE_CMD_UNLOCK,
  SMOOTHIE_CMD_VERSION,
} from './commands';

const EMPTY_REASON = 'Enter one Smoothieware G-code or console command.';
const MULTILINE_REASON = 'Console commands and saved macros must contain exactly one line.';
const BLOCKED_PERSISTENT_REASON =
  'config-set/config-load write persistent Smoothie configuration and are blocked in the Console.';
const SHELL_UNLOCK_REASON =
  'Smoothieware answers $X only while halted, so the Console could wait forever for its ok. Use M999 to clear a halt.';
const LOWERCASE_GCODE_REASON =
  'Smoothieware reads a line that starts with a lowercase letter as a shell command, not G-code. Type G-code in capitals (for example M114).';

const QUERY_COMMANDS: ReadonlySet<string> = new Set([
  '?',
  SMOOTHIE_CMD_POSITION,
  SMOOTHIE_CMD_FIRMWARE_INFO,
]);
// Shell lines with a printed completion. SimpleShell matches them exactly.
const SHELL_QUERIES: ReadonlySet<string> = new Set([SMOOTHIE_CMD_VERSION, '$G', '$#']);
const SHELL_COMMANDS_WITH_COMPLETION: ReadonlySet<string> = new Set([
  ...SHELL_QUERIES,
  SMOOTHIE_CMD_HOME,
  SMOOTHIE_CMD_FIRE_OFF,
]);
// $I and $S print text only, $J prints ok only with -r, a bare `$` is
// ignored by both dispatchers, and $X is answered only while halted.
const ACKLESS_DOLLAR_RE = /^\$(?:[IJS]|$)/;
// G28 homes or parks (dialect-dependent); G28.2 homes or parks; G28.3/G28.4
// set the homed position by hand; G28.5 clears the homed flags (Endstops.cpp).
// G28.1 only stores the park point and G28.6 only reports.
const REFERENCE_GCODE_RE = /G28(?:\.[02345])?(?=$|[^0-9.])/i;

export function prepareSmoothieConsoleCommand(input: string): ConsoleCommandResult {
  const normalized = normalizeConsoleSpaces(input).trim();
  if (normalized === '') return { ok: false, reason: EMPTY_REASON };
  if (/[\r\n]/.test(normalized)) return { ok: false, reason: MULTILINE_REASON };
  const textRefusal = consoleTextRefusal(normalized);
  if (textRefusal !== null) return { ok: false, reason: textRefusal };
  const upper = normalized.toUpperCase();
  if (/^CONFIG-(SET|LOAD)\b/.test(upper)) {
    return { ok: false, reason: BLOCKED_PERSISTENT_REASON };
  }
  if (normalized === '?') {
    return command('gcode', normalized, '?', false, false, 'read-only');
  }
  if (upper === SMOOTHIE_CMD_UNLOCK) {
    // Halt recovery must stay available while an operation is wedged.
    return command('gcode', normalized, `${normalized}\n`, false, false, 'reference');
  }
  const shellRefusal = shellLineRefusal(normalized);
  if (shellRefusal !== null) return { ok: false, reason: shellRefusal };
  if (QUERY_COMMANDS.has(upper) || SHELL_QUERIES.has(normalized)) {
    return command('gcode', normalized, `${normalized}\n`, false, true, 'read-only');
  }
  const stateEffect =
    normalized === SMOOTHIE_CMD_HOME || REFERENCE_GCODE_RE.test(normalized)
      ? 'reference'
      : commonConsoleStateEffect(normalized);
  return command('gcode', normalized, `${normalized}\n`, true, true, stateEffect);
}

/** Why a SimpleShell line cannot go out from the Console, or null for G-code
 *  and for the shell lines whose completion Smoothieware prints. */
function shellLineRefusal(line: string): string | null {
  if (SHELL_COMMANDS_WITH_COMPLETION.has(line)) return null;
  const first = line[0] ?? '';
  if (first === '$') {
    if (line.startsWith('$X')) return SHELL_UNLOCK_REASON;
    // Any other `$` letter draws `error:Invalid statement`, a terminal reply.
    return ACKLESS_DOLLAR_RE.test(line) ? acklessShellReason(line) : null;
  }
  if (!/[a-z]/.test(first)) return null;
  if (/^[fgmnstxyz]-?[\d.]/.test(line)) return LOWERCASE_GCODE_REASON;
  return acklessShellReason(line);
}

function acklessShellReason(line: string): string {
  const word = line.split(/\s+/, 1)[0] ?? line;
  return (
    `Smoothieware's shell answers ${word} without an ok, so KerfDesk cannot tell when it ` +
    'has finished. From the Console the shell accepts only version, fire off, $G, $# and $H.'
  );
}

function command(
  kind: 'gcode',
  normalized: string,
  wire: string,
  requiresIdle: boolean,
  requiresNoActiveOperation: boolean,
  stateEffect: ConsoleStateEffect,
): ConsoleCommandResult {
  return {
    ok: true,
    command: {
      kind,
      normalized,
      wire,
      requiresIdle,
      requiresNoActiveOperation,
      requiresConfirmation: false,
      stateEffect,
    },
  };
}
