// What the rail's Alarm card says once Reset is no longer the only way out.
//
// The alarm table's ALARM:1 and ALARM:2 actions begin "The controller accepts
// only a soft reset now: press Reset (Ctrl-X)", which is right before the
// reset, when the card offers Reset and words it itself (ADR-393 Amendment 1).
// After the reset the same card offered Home and Unlock beside a sentence still
// telling the beginner to press Reset, and told a machine with homing off to
// re-home (UX audit U4-P3-4, U5-P3-2). Homing failures name the switches and
// Machine Setup first (U5-P3-3).

import {
  grblHalEvidence,
  type GrblHalSessionEvidence,
} from '../../core/controllers/grblhal/grblhal-evidence';
import type { ControllerKind } from '../../core/devices';

/** The firmware whose alarm table decodes the card. A grblHAL board that sent
 *  no banner runs on the stock GRBL driver, where its E-stop (ALARM:10) read
 *  "Homing fail — dual-axis switch"; its `$$` or `$I` still shows grblHAL
 *  (UX audit U5-P3-4; grblhal-evidence.ts). */
export function alarmControllerKind(
  state: GrblHalSessionEvidence & { readonly activeControllerKind: ControllerKind },
): ControllerKind {
  return state.activeControllerKind === 'grbl-v1.1' && grblHalEvidence(state) !== null
    ? 'grblhal'
    : state.activeControllerKind;
}

/** ALARM:8 and 9 on every GRBL family, and grblHAL's auto-squared axis (15). */
export function isHomingFailureAlarm(code: number | null, controllerKind: ControllerKind): boolean {
  if (controllerKind === 'fluidnc' || code === null) return false;
  return code === 8 || code === 9 || (code === 15 && controllerKind === 'grblhal');
}

/** The card's action sentence when no reset is pending. */
export function alarmCardAction(
  code: number | null,
  controllerKind: ControllerKind,
  action: string | undefined,
  homingEnabled: boolean,
): string | undefined {
  if (controllerKind === 'fluidnc') return action;
  if (code === 1) {
    const next = homingEnabled ? 'Home ($H) to find the position again' : 'Unlock ($X)';
    return `Clear whatever the head ran into, move it off the limit switch, and check that the design and origin fit the bed. Then ${next}.`;
  }
  if (code === 2) {
    return 'The position is kept, so Unlock ($X) is safe. Then check that the design fits the bed.';
  }
  return action;
}
