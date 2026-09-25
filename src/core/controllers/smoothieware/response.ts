// Smoothieware response classification. Smoothie speaks a GRBL-flavored
// protocol: `ok` acks, `<Idle|MPos:...,WPos:...>` status reports (via the
// realtime `?`), text errors (`error:Alarm lock`), `!!` markers while the
// firmware is halted (kill/limit), and a `Smoothie` welcome banner. Halt has
// no numeric alarm codes: the Alarm STATE arrives via status reports.
//
// `ALARM: …` lines answer no command (controller audit SM-8). The firmware
// prints them on its own when it halts — `ALARM: Hard limit +X`
// (Endstops.cpp L420-L430), `ALARM: Kill button pressed …` (KillButton.cpp
// L53-L64), `ALARM: Abort during cycle` after Ctrl-X in grbl mode
// (USBSerial.cpp L302-L314) — or before the command's own `ok`
// (`ALARM: Homing fail`, Endstops.cpp L895-L902 then SimpleShell's `ok`;
// `ALARM: Probe fail`, ZProbe.cpp L492-L496 then GcodeDispatch's `ok`). So
// they are a code-less alarm event, never a terminal reply. `!!`,
// `error:Alarm lock` and GcodeDispatch's `error:`/`Error:` lines are real
// replies and stay terminal (GcodeDispatch.cpp L158-L180, L385-L403).
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/endstops/Endstops.cpp#L420-L430

import type { ControllerEvent } from '../controller-event';
import { parseStatusReport } from '../grbl/status-parser';
import { parseCommaStatusReport } from './comma-status-report';
import { SMOOTHIE_FIRE_OFF_COMPLETE, SMOOTHIE_VERSION_COMPLETE_PREFIX } from './commands';
import { SMOOTHIE_HOMED_FLAGS_LINE_RE } from './home-verification';
import { smoothieStatusReport } from './status-report-fields';

const OK_RE = /^ok\b/i;
const ERROR_RE = /^error:/i;
const HALT_RE = /^!!/;
const ALARM_TEXT_RE = /^ALARM/i;
// Laser.cpp answers `M221` with no argument with its power report; the Laser
// module probe (laser-module.ts) reads it as a response line.
const LASER_REPORT_RE = /^Laser power\b/;
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
  if (HALT_RE.test(trimmed) || ERROR_RE.test(trimmed)) {
    return { kind: 'error', code: null, raw: trimmed };
  }
  if (ALARM_TEXT_RE.test(trimmed)) return { kind: 'alarm', code: null, raw: trimmed };
  const status = classifyStatusLine(trimmed);
  if (status !== null) return status;
  if (LASER_REPORT_RE.test(trimmed)) return { kind: 'message', tag: 'LASER', body: trimmed };
  // G28.6 prints `X:1 Y:1 ` (Endstops.cpp:1114-1120); the Home verification
  // reads it as a response line (home-verification.ts, audit SM-6).
  if (SMOOTHIE_HOMED_FLAGS_LINE_RE.test(trimmed)) {
    return { kind: 'message', tag: 'HOMED', body: trimmed };
  }
  // GcodeDispatch prints FIRMWARE_NAME only in answer to M115, followed by
  // `ok`; it is an identity reply, never a reboot, so it must not cross the
  // controller-reset boundary a welcome banner does.
  // https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/communication/GcodeDispatch.cpp
  if (FIRMWARE_RE.test(trimmed)) return { kind: 'message', tag: 'FIRMWARE', body: trimmed };
  if (WELCOME_RE.test(trimmed)) return { kind: 'welcome', raw: trimmed };
  return { kind: 'unknown', raw: trimmed };
}

function classifyStatusLine(trimmed: string): ControllerEvent | null {
  if (!trimmed.startsWith('<')) return null;
  // GRBL-1.1 pipe grammar first; fall back to the classic comma grammar some
  // Smoothie builds emit (CTL-05) so the DRO updates either way.
  const report = parseStatusReport(trimmed) ?? parseCommaStatusReport(trimmed);
  return report === null ? null : { kind: 'status', report: smoothieStatusReport(report, trimmed) };
}
