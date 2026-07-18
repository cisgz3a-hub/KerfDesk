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

export function classifyMarlinResponse(line: string): ControllerEvent {
  const trimmed = line.trim();
  if (OK_RE.test(trimmed)) return { kind: 'ok' };
  if (BUSY_RE.test(trimmed)) return { kind: 'busy' };
  const resend = RESEND_RE.exec(trimmed);
  if (resend !== null) {
    return { kind: 'resend', line: Number.parseInt(resend[1] ?? '0', 10) };
  }
  if (ERROR_RE.test(trimmed)) return { kind: 'error', code: null, raw: trimmed };
  if (trimmed === 'start' || FIRMWARE_RE.test(trimmed) || /^Marlin\b/.test(trimmed)) {
    return { kind: 'welcome', raw: trimmed };
  }
  const report = parseMarlinPositionReport(trimmed);
  if (report !== null) return { kind: 'status', report };
  const echo = ECHO_RE.exec(trimmed);
  if (echo !== null) return { kind: 'message', tag: 'echo', body: echo[1] ?? '' };
  return { kind: 'unknown', raw: trimmed };
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
