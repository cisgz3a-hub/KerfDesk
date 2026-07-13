// Console-input validation for Marlin. Same result shape as the GRBL module
// so the console action/store path is firmware-neutral. Persistent-settings
// writes (M500 save / M502 factory reset) are blocked, matching the GRBL
// console's $RST/$N policy. M112 (emergency stop) is deliberately allowed at
// any time — it is the point of an E-stop.

import type { ConsoleCommandResult } from '../grbl/console-command';
import { commonConsoleStateEffect, type ConsoleStateEffect } from '../console-state-effect';
import {
  MARLIN_CMD_EMERGENCY_STOP,
  MARLIN_CMD_FIRMWARE_INFO,
  MARLIN_CMD_POSITION,
  MARLIN_CMD_SETTINGS_DUMP,
  MARLIN_CMD_TEMPERATURES,
} from './commands';

const EMPTY_REASON = 'Enter one Marlin G-code or M-code command.';
const MULTILINE_REASON =
  'Console commands must be one line. Use macros later for multi-line commands.';
const BLOCKED_PERSISTENT_REASON =
  'M500/M502 write persistent firmware settings and are blocked in the Console.';

const QUERY_COMMANDS: ReadonlySet<string> = new Set([
  MARLIN_CMD_POSITION,
  MARLIN_CMD_FIRMWARE_INFO,
  MARLIN_CMD_SETTINGS_DUMP,
  MARLIN_CMD_TEMPERATURES,
  'M119', // endstop states
]);

export function prepareMarlinConsoleCommand(input: string): ConsoleCommandResult {
  const normalized = input.trim();
  if (normalized === '') return { ok: false, reason: EMPTY_REASON };
  if (/[\r\n]/.test(normalized)) return { ok: false, reason: MULTILINE_REASON };
  const upper = normalized.toUpperCase();
  if (upper === 'M500' || upper === 'M502') {
    return { ok: false, reason: BLOCKED_PERSISTENT_REASON };
  }
  if (upper === MARLIN_CMD_EMERGENCY_STOP) {
    // E-stop: never gated on idle or active operations.
    return command('gcode', normalized, false, false, 'reference');
  }
  if (QUERY_COMMANDS.has(upper)) {
    return command('gcode', normalized, false, true, 'read-only');
  }
  return command('gcode', normalized, true, true, marlinStateEffect(normalized));
}

function command(
  kind: 'gcode',
  normalized: string,
  requiresIdle: boolean,
  requiresNoActiveOperation: boolean,
  stateEffect: ConsoleStateEffect,
): ConsoleCommandResult {
  return {
    ok: true,
    command: {
      kind,
      normalized,
      wire: `${normalized}\n`,
      requiresIdle,
      requiresNoActiveOperation,
      requiresConfirmation: false,
      stateEffect,
    },
  };
}

function marlinStateEffect(input: string): ConsoleStateEffect {
  const upper = input.toUpperCase();
  if (/G28(?=$|[^0-9.])/.test(upper)) return 'reference';
  if (/M(?:92|206|428)(?=$|[^0-9.])/.test(upper)) return 'configuration';
  if (/M851(?=$|[^0-9.])/.test(upper)) return 'tool';
  return commonConsoleStateEffect(input);
}
