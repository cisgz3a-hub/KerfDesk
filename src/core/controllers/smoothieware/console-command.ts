// Console-input validation for Smoothieware. Persistent config writes
// (config-set / config-load) are blocked, matching the GRBL console's
// $RST/$N policy. M999 (halt recovery) is allowed while operations are
// stuck — it is the recovery command.

import type { ConsoleCommandResult } from '../grbl/console-command';
import {
  SMOOTHIE_CMD_FIRMWARE_INFO,
  SMOOTHIE_CMD_POSITION,
  SMOOTHIE_CMD_UNLOCK,
  SMOOTHIE_CMD_VERSION,
} from './commands';

const EMPTY_REASON = 'Enter one Smoothieware G-code or console command.';
const MULTILINE_REASON =
  'Console commands must be one line. Use macros later for multi-line commands.';
const BLOCKED_PERSISTENT_REASON =
  'config-set/config-load write persistent Smoothie configuration and are blocked in the Console.';

const QUERY_COMMANDS: ReadonlySet<string> = new Set([
  '?',
  SMOOTHIE_CMD_POSITION,
  SMOOTHIE_CMD_FIRMWARE_INFO,
  SMOOTHIE_CMD_VERSION.toUpperCase(),
]);

export function prepareSmoothieConsoleCommand(input: string): ConsoleCommandResult {
  const normalized = input.trim();
  if (normalized === '') return { ok: false, reason: EMPTY_REASON };
  if (/[\r\n]/.test(normalized)) return { ok: false, reason: MULTILINE_REASON };
  const upper = normalized.toUpperCase();
  if (/^CONFIG-(SET|LOAD)\b/.test(upper)) {
    return { ok: false, reason: BLOCKED_PERSISTENT_REASON };
  }
  if (normalized === '?') {
    return command('gcode', normalized, '?', false, false);
  }
  if (upper === SMOOTHIE_CMD_UNLOCK) {
    // Halt recovery must stay available while an operation is wedged.
    return command('gcode', normalized, `${normalized}\n`, false, false);
  }
  if (QUERY_COMMANDS.has(upper)) {
    return command('gcode', normalized, `${normalized}\n`, false, true);
  }
  return command('gcode', normalized, `${normalized}\n`, true, true);
}

function command(
  kind: 'gcode',
  normalized: string,
  wire: string,
  requiresIdle: boolean,
  requiresNoActiveOperation: boolean,
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
    },
  };
}
