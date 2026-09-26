// Printed text of the Smoothieware simulator (smoothie-simulator.ts), each
// line as Smoothieware edge 38e2cc08 prints it.

import type { SimVec3 } from './grbl-sim-gcode';
import { workPosition, type SmoothieSimMachine } from './smoothie-sim-machine';

/** Kernel::get_query_string (Kernel.cpp L177-L334). Running (Run, Home):
 *  `|F:<current>,<requested>,<override>` then `|L:<laser %>|S:<S>` with the
 *  Laser module, `|S:<spindle>` without. Otherwise `|F:<requested>,<override>`
 *  and `|S:<spindle>` only without the module. Halted reads `Alarm`. */
export function smoothieStatusLine(m: SmoothieSimMachine): string {
  const running = !m.isHalted && (m.machine === 'Run' || m.machine === 'Home');
  const label = m.isHalted ? 'Alarm' : m.machine;
  const positions = `|MPos:${vec(m.pos)}|WPos:${vec(workPosition(m))}`;
  return `<${label}${positions}${running ? runningFields(m) : restingFields(m)}>`;
}

function runningFields(m: SmoothieSimMachine): string {
  const feed = `|F:${m.currentRate.toFixed(1)},${m.feedRate.toFixed(1)},100.0`;
  if (m.cfg.laserModule === 'absent') return `${feed}|S:${m.power.sValue.toFixed(2)}`;
  return `${feed}|L:${laserPercent(m).toFixed(4)}|S:${m.power.sValue.toFixed(4)}`;
}

function restingFields(m: SmoothieSimMachine): string {
  const feed = `|F:${m.feedRate.toFixed(1)},100.0`;
  return m.cfg.laserModule === 'absent' ? `${feed}|S:${m.power.sValue.toFixed(2)}` : feed;
}

// Laser::get_current_power: the PWM output now, in percent.
function laserPercent(m: SmoothieSimMachine): number {
  if (m.power.manualFire > 0) return m.power.manualFire * 100;
  const last = m.power.burns.at(-1);
  return m.machine === 'Run' && m.motionMode === 1 && last !== undefined ? last.power * 100 : 0;
}

function vec(v: SimVec3): string {
  return `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
}

/** Laser::on_gcode_received for `M221` with no argument (Laser.cpp L198-L202;
 *  before 971eb8cf the report was `Laser power scale at`). Null: no module. */
export function smoothieLaserReport(m: SmoothieSimMachine): string | null {
  const scale = (m.power.scale * 100).toFixed(2).padStart(6);
  if (m.cfg.laserModule === 'absent') return null;
  if (m.cfg.laserModule === 'pre-2021') return `Laser power scale at ${scale} %`;
  const autoPowerDisabled = m.power.proportional ? 0 : 1;
  return `Laser power: ${scale} %, disable auto power: ${autoPowerDisabled}, PWM frequency: 50000.000000 Hz`;
}

/** Laser::on_console_line_received for `fire …` (Laser.cpp L124-L179). */
export function smoothieFireReply(line: string, manualFire: boolean): string {
  const argument = line.split(/\s+/)[1];
  if (argument === undefined) return 'Usage: fire power% [durationms]|off|status';
  if (argument === 'status') return `laser manual state: ${manualFire ? 'on' : 'off'}`;
  if (argument === 'off' || argument === '0') return 'turning laser off and returning to auto mode';
  const percent = Math.min(100, Math.max(0, Number(argument)));
  return `WARNING: Firing laser at ${percent.toFixed(2)}% power, entering manual mode use fire off to return to auto mode`;
}

/** Endstops G28.6 (Endstops.cpp L1114-L1120): `<axis>:<homed> ` for each axis
 *  with a homing pin, then GcodeDispatch's newline and `ok`. */
export function smoothieHomedReport(m: SmoothieSimMachine): ReadonlyArray<string> {
  if (!m.cfg.endstops) return ['ok'];
  const homed = m.isHomed ? 1 : 0;
  return [`X:${homed} Y:${homed} `, 'ok'];
}

export function smoothieFirmwareReply(grblMode: boolean): ReadonlyArray<string> {
  return [
    `FIRMWARE_NAME:Smoothieware, FIRMWARE_URL:http%3A//smoothieware.org, X-GRBL_MODE:${grblMode ? 1 : 0}`,
    'ok',
  ];
}
