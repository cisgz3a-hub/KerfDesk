// Marlin serial response classification. Marlin's vocabulary is text-based:
// `ok` acks (optionally `ok P.. B..` with ADVANCED_OK), `echo:busy:` keepalives,
// `Error:<text>` (no numeric codes), `Resend: N` in checksum mode, `start` on
// boot, `FIRMWARE_NAME:Marlin ...` from M115, and `X:.. Y:.. Z:..` position
// lines from M114. Everything maps into the shared ControllerEvent union.

import type { ControllerEvent } from '../controller-event';
import type { StatusReport } from '../grbl/status-parser';

const OK_RE = /^ok\b/i;
const BUSY_RE = /^echo:\s*busy/i;
const ERROR_RE = /^Error:/i;
const RESEND_RE = /^Resend:\s*(\d+)/i;
const FIRMWARE_RE = /FIRMWARE_NAME:/i;
const POSITION_RE = /^X:(-?\d+(?:\.\d+)?)\s+Y:(-?\d+(?:\.\d+)?)\s+Z:(-?\d+(?:\.\d+)?)/;
const ECHO_RE = /^echo:\s*(.*)$/i;
// parser.cpp unknown_command_warning: SERIAL_ECHO_MSG("Unknown command: \"",
// command_ptr, "\""), then gcode.cpp L1122 answers the line with `ok`.
const UNKNOWN_COMMAND_RE = /^echo:\s*Unknown command:\s*"(.*)"\s*$/i;
// MarlinCore.cpp kill(): SERIAL_ERROR_MSG(STR_ERR_KILLED), then minkill()
// waits for the RESET button or a power cycle; nothing answers after it.
const KILLED_RE = /^Error:\s*Printer halted\.?\s*kill\(\) called!?/i;

export function classifyMarlinResponse(line: string): ControllerEvent {
  const trimmed = line.trim();
  if (OK_RE.test(trimmed)) return { kind: 'ok' };
  if (BUSY_RE.test(trimmed)) return { kind: 'busy' };
  const resend = RESEND_RE.exec(trimmed);
  if (resend !== null) {
    return { kind: 'resend', line: Number.parseInt(resend[1] ?? '0', 10) };
  }
  if (ERROR_RE.test(trimmed)) return classifyMarlinError(trimmed);
  if (trimmed === 'start' || FIRMWARE_RE.test(trimmed) || /^Marlin\b/.test(trimmed)) {
    return { kind: 'welcome', raw: trimmed };
  }
  return classifyMarlinReport(trimmed);
}

function classifyMarlinReport(trimmed: string): ControllerEvent {
  const report = parseMarlinPositionReport(trimmed);
  if (report !== null) return { kind: 'status', report };
  const unknownCommand = UNKNOWN_COMMAND_RE.exec(trimmed);
  if (unknownCommand !== null) return unknownCommandEvent(unknownCommand[1] ?? '', trimmed);
  const echo = ECHO_RE.exec(trimmed);
  if (echo !== null) return { kind: 'message', tag: 'echo', body: echo[1] ?? '' };
  return { kind: 'unknown', raw: trimmed };
}

function classifyMarlinError(trimmed: string): ControllerEvent {
  return KILLED_RE.test(trimmed)
    ? { kind: 'error', code: null, raw: trimmed, halted: true }
    : { kind: 'error', code: null, raw: trimmed };
}

function unknownCommandEvent(command: string, raw: string): ControllerEvent {
  return {
    kind: 'unknown-command',
    command: command.trim(),
    raw,
    requirement: marlinBuildRequirement(command),
  };
}

/**
 * The Configuration.h / Configuration_adv.h option whose absence makes Marlin
 * answer a command KerfDesk sends with "Unknown command". gcode.cpp
 * (2.1.2.8) dispatches M3/M4/M5 only #if HAS_CUTTER (L489-L493), M7 only with
 * COOLANT_MIST (L495-L497), M8 only with AIR_ASSIST or COOLANT_FLOOD
 * (L499-L501), M9 only with AIR_ASSIST or COOLANT_CONTROL (L503-L505) and
 * M106/M107 only #if HAS_FAN (L591-L594). Anything else has no entry.
 */
const MARLIN_M_CODE_REQUIREMENTS: ReadonlyMap<number, string> = new Map([
  [3, 'LASER_FEATURE (a laser cutter)'],
  [4, 'LASER_FEATURE (a laser cutter)'],
  [5, 'LASER_FEATURE (a laser cutter)'],
  [7, 'COOLANT_MIST'],
  [8, 'AIR_ASSIST (or COOLANT_FLOOD)'],
  [9, 'AIR_ASSIST (or COOLANT_CONTROL)'],
  [106, 'a fan output (HAS_FAN)'],
  [107, 'a fan output (HAS_FAN)'],
]);

export function marlinBuildRequirement(command: string): string | null {
  const code = /^\s*M0*(\d+)(?![\d.])/i.exec(command)?.[1];
  return code === undefined ? null : (MARLIN_M_CODE_REQUIREMENTS.get(Number(code)) ?? null);
}

/** M114 reply -> StatusReport. Marlin has no machine-state reporting, and its
 * default M114 reports the projected destination rather than proving physical
 * motion has drained. The Idle-shaped report is status evidence only; motion
 * authorization first crosses an owned M400 marker. Feed/spindle/WCO remain
 * unknown on this firmware. */
export function parseMarlinPositionReport(line: string): StatusReport | null {
  const match = POSITION_RE.exec(line);
  if (match === null) return null;
  const x = Number.parseFloat(match[1] ?? '');
  const y = Number.parseFloat(match[2] ?? '');
  const z = Number.parseFloat(match[3] ?? '');
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return {
    state: 'Idle',
    subState: null,
    mPos: { x, y, z },
    wPos: null,
    feed: null,
    spindle: null,
    wco: null,
  };
}
