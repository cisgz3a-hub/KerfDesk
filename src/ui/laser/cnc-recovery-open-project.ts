// CNC pass and supervised recovery start only with a CNC project open (ADR-416
// Amendment 3, rolling audit v3 G2-P1-1). The recovery streams the saved CNC
// job whatever is open, but the bit-change hold it reaches is worked from the
// open project: the touch-plate probe's geometry, the bit list, the point-move
// bed mapping and the jog feeds come from it, and the Laser/CNC switch stays
// locked to it. The bit in the spindle itself is session state since ADR-416
// Amendment 4, so Zero Z no longer needs the project; the rest still does.
//
// A CNC that KerfDesk 1.0.29 may have made from a laser does not start a
// recovery either until its owner says whether it is a laser (ADR-637
// Amendment 10, rolling audit v12 X2-P2-1): the recovered program starts the
// spindle, which on a laser is the beam at full power.
//
// Checked before the first dialog and again at the final Start assertion, as
// the external run does (external-run.ts), because the Laser/CNC switch stays
// usable while the recovery confirmations are open. A refusal keeps the saved
// recovery on its card.

import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import {
  CONVERTED_LASER_HEADING,
  CONVERTED_LASER_RISK,
  convertedLaserQuestion,
} from '../state/converted-laser-question';
import { useLaserStore } from '../state/laser-store';

export const CNC_RECOVERY_NEEDS_CNC_PROJECT =
  'The open project is in Laser mode. A CNC recovery stops at bit changes, where Zero Z and the probe work from the open CNC project. Open the CNC project this job came from, or switch the toolbar to CNC, then start the recovery again. The saved recovery stays on its card, and no controller command was sent.';

export const CNC_RECOVERY_ASKS_IF_LASER = `${CONVERTED_LASER_HEADING} ${CONVERTED_LASER_RISK} Answer it first: on the canvas card or in Machine Setup, choose "It's a laser" or "This is a CNC router", then start the recovery again. The saved recovery stays on its card, and no controller command was sent.`;

/** The recovery card's reminder, beside its note that the run is isolated. */
export const CNC_RECOVERY_OPEN_PROJECT_NOTE =
  'It still starts only with a CNC project open, because its bit changes are worked from that project.';

/** Why a CNC recovery cannot start with the open project, or null. */
export function cncRecoveryOpenProjectIssue(): string | null {
  const project = useStore.getState().project;
  if (machineKindOf(project.machine) !== 'cnc') return CNC_RECOVERY_NEEDS_CNC_PROJECT;
  return convertedLaserQuestion(project, useLaserStore.getState()) === null
    ? null
    : CNC_RECOVERY_ASKS_IF_LASER;
}

/** The final-assertion form: throws when the open project is not CNC. */
export function assertCncRecoveryOpenProject(): void {
  const issue = cncRecoveryOpenProjectIssue();
  if (issue !== null) throw new Error(issue);
}
