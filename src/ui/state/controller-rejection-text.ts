// Plain words for a controller's `error:N` and `ALARM:N` (UX audit U2-P2-2).
// The notices and the action toasts showed the bare code, and the decoded
// meaning reached only the Console. This reads the same tables the Console
// uses (response-presentation.ts: GRBL, grblHAL and FluidNC). Marlin answers
// with text, not codes, so its reply is quoted as it came.

import type { ControllerKind } from '../../core/devices';
import { presentAlarm, presentError } from '../../core/controllers/grbl/response-presentation';

export type ControllerRejectionText = {
  /** What the controller said, decoded: "Jog target exceeds travel (error:15)". */
  readonly reason: string;
  /** The table's longer explanation, when it has one. */
  readonly detail: string | null;
  /** The reply was an alarm, not a rejected line. */
  readonly alarm: boolean;
  /** The controller refused Home because homing is off in its settings. */
  readonly homingOff: boolean;
};

const ERROR_CODE_RE = /\berror:(\d+)/i;
const ALARM_CODE_RE = /\bALARM:(\d+)/i;

/** Decodes `code` (an error number) or the first `error:N` / `ALARM:N` in `raw`. */
export function controllerRejectionText(
  controllerKind: ControllerKind,
  code: number | null,
  raw?: string,
): ControllerRejectionText {
  const alarm = raw === undefined ? null : ALARM_CODE_RE.exec(raw);
  if (alarm?.[1] !== undefined) return alarmText(controllerKind, Number(alarm[1]));
  const errorCode = code ?? codeIn(raw);
  if (errorCode !== null) return errorText(controllerKind, errorCode);
  const reply = raw?.trim() ?? '';
  return {
    reason: reply === '' ? 'an error with no code' : `the reply “${reply}”`,
    detail: null,
    alarm: false,
    homingOff: false,
  };
}

function codeIn(raw: string | undefined): number | null {
  const match = raw === undefined ? null : ERROR_CODE_RE.exec(raw);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function errorText(controllerKind: ControllerKind, code: number): ControllerRejectionText {
  const description = presentError(controllerKind, code);
  return {
    reason: labelled(description?.title, `error:${code}`),
    detail: description?.detail ?? null,
    alarm: false,
    homingOff: isHomingOffError(controllerKind, code),
  };
}

function alarmText(controllerKind: ControllerKind, code: number): ControllerRejectionText {
  const description = presentAlarm(controllerKind, code);
  const detail = [description?.detail, description?.action]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ');
  return {
    reason: labelled(description?.title, `ALARM:${code}`),
    detail: detail === '' ? null : detail,
    alarm: true,
    homingOff: false,
  };
}

function labelled(title: string | undefined, label: string): string {
  return title === undefined ? label : `${title.replace(/\.$/, '')} (${label})`;
}

// GRBL and grblHAL answer `$H` with error:5 while `$22=0` (gnea/grbl
// error_codes_en_US.csv: "Homing is not enabled via settings"); FluidNC's
// equivalent is error 18, "No Homing/Cycle defined in settings".
function isHomingOffError(controllerKind: ControllerKind, code: number): boolean {
  if (controllerKind === 'fluidnc') return code === 18;
  return (controllerKind === 'grbl-v1.1' || controllerKind === 'grblhal') && code === 5;
}

/** Home refused with homing off: what it means and the two ways on (U2-P3-9). */
export function homingOffAdvice(controllerKind: ControllerKind): string {
  const setting = controllerKind === 'fluidnc' ? 'in its configuration' : 'with the setting $22=1';
  return (
    'Homing is turned off in the controller, so it refused Home and the machine did not move. ' +
    'If this machine has no homing switches, untick Enable Home in Machine Setup and set the origin ' +
    `by hand. If it has homing switches, homing can be turned on in the controller ${setting}; ` +
    'never turn it on for a machine without switches.'
  );
}

/** The reason and its detail as one or two sentences. */
export function rejectionSentences(text: ControllerRejectionText): string {
  return text.detail === null ? `${text.reason}.` : `${text.reason}. ${text.detail}`;
}
