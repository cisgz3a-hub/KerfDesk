// Smoothieware response classification. Smoothie speaks a GRBL-flavored
// protocol: `ok` acks, `<Idle|MPos:...,WPos:...>` status reports (via the
// realtime `?`), text errors (`error:Alarm lock`), `!!` markers while the
// firmware is halted (kill/limit), and a `Smoothie` welcome banner. Halt has
// no numeric alarm codes — the Alarm STATE arrives via status reports, so
// halt markers map to terminal stream errors rather than alarm events.

import type { ControllerEvent } from '../controller-event';
import { parseStatusReport } from '../grbl/status-parser';
import { parseCommaStatusReport } from './comma-status-report';

const OK_RE = /^ok\b/i;
const ERROR_RE = /^error:/i;
const HALT_RE = /^!!/;
const ALARM_TEXT_RE = /^ALARM/i;
const WELCOME_RE = /^Smoothie/i;
const FIRMWARE_RE = /FIRMWARE_NAME:\s*Smoothie/i;

export function classifySmoothieResponse(line: string): ControllerEvent {
  const trimmed = line.trim();
  if (OK_RE.test(trimmed)) return { kind: 'ok' };
  if (HALT_RE.test(trimmed) || ALARM_TEXT_RE.test(trimmed) || ERROR_RE.test(trimmed)) {
    return { kind: 'error', code: null, raw: trimmed };
  }
  if (trimmed.startsWith('<')) {
    // GRBL-1.1 pipe grammar first; fall back to the classic comma grammar some
    // Smoothie builds emit (CTL-05) so the DRO updates either way.
    const report = parseStatusReport(trimmed) ?? parseCommaStatusReport(trimmed);
    if (report !== null) return { kind: 'status', report };
  }
  if (WELCOME_RE.test(trimmed) || FIRMWARE_RE.test(trimmed)) {
    return { kind: 'welcome', raw: trimmed };
  }
  return { kind: 'unknown', raw: trimmed };
}
