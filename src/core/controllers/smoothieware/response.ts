// Smoothieware response classification. Smoothie speaks a GRBL-flavored
// protocol: `ok` acks, `<Idle|MPos:...,WPos:...>` status reports (via the
// realtime `?`), text errors (`error:Alarm lock`), `!!` markers while the
// firmware is halted (kill/limit), and a `Smoothie` welcome banner. Halt has
// no numeric alarm codes — the Alarm STATE arrives via status reports, so
// halt markers map to terminal stream errors rather than alarm events.

import type { ControllerEvent } from '../controller-event';
import { parseStatusReport } from '../grbl/status-parser';
import { parseCommaStatusReport } from './comma-status-report';
import { SMOOTHIE_FIRE_OFF_COMPLETE, SMOOTHIE_VERSION_COMPLETE_PREFIX } from './commands';

const OK_RE = /^ok\b/i;
const ERROR_RE = /^error:/i;
const HALT_RE = /^!!/;
const ALARM_TEXT_RE = /^ALARM/i;
// USBSerial prints `Smoothie` + `ok` when the host attaches and the kernel
// prints `Smoothie Running @...MHz` at boot: the only greetings Smoothie has.
const WELCOME_RE = /^Smoothie/i;
const FIRMWARE_RE = /^FIRMWARE_NAME:\s*Smoothie/i;

export function classifySmoothieResponse(line: string): ControllerEvent {
  const trimmed = line.trim();
  if (OK_RE.test(trimmed)) return { kind: 'ok' };
  // Qualified Smoothieware V1 Laser.cpp prints this once for `fire off` and
  // does not emit a subsequent `ok`. This is its native command completion.
  if (trimmed === SMOOTHIE_FIRE_OFF_COMPLETE) return { kind: 'ok' };
  // SimpleShell `version` never prints `ok` either; its first line is its
  // completion (the axis count and an optional NOTICE line that follow stay
  // unclassified text). No other command prints this line.
  // https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/utils/simpleshell/SimpleShell.cpp
  if (trimmed.startsWith(SMOOTHIE_VERSION_COMPLETE_PREFIX)) return { kind: 'ok' };
  if (HALT_RE.test(trimmed) || ALARM_TEXT_RE.test(trimmed) || ERROR_RE.test(trimmed)) {
    return { kind: 'error', code: null, raw: trimmed };
  }
  if (trimmed.startsWith('<')) {
    // GRBL-1.1 pipe grammar first; fall back to the classic comma grammar some
    // Smoothie builds emit (CTL-05) so the DRO updates either way.
    const report = parseStatusReport(trimmed) ?? parseCommaStatusReport(trimmed);
    if (report !== null) return { kind: 'status', report };
  }
  // GcodeDispatch prints FIRMWARE_NAME only in answer to M115, followed by
  // `ok`; it is an identity reply, never a reboot, so it must not cross the
  // controller-reset boundary a welcome banner does.
  // https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/communication/GcodeDispatch.cpp
  if (FIRMWARE_RE.test(trimmed)) return { kind: 'message', tag: 'FIRMWARE', body: trimmed };
  if (WELCOME_RE.test(trimmed)) return { kind: 'welcome', raw: trimmed };
  return { kind: 'unknown', raw: trimmed };
}
