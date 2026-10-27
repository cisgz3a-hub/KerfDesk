// CNC pass and supervised recovery start only with a CNC project open (ADR-416
// Amendment 3, rolling audit v3 G2-P1-1). The recovery streams the saved CNC
// job whatever is open, but the bit-change hold it reaches is worked from the
// open project: the Active bit that Zero Z and the probe bind to is chosen
// there, and the Laser/CNC switch stays locked to it. With a Laser project
// open, Continue could never unlock, and only Abort ended the run.
//
// Checked before the first dialog and again at the final Start assertion, as
// the external run does (external-run.ts), because the Laser/CNC switch stays
// usable while the recovery confirmations are open. A refusal keeps the saved
// recovery on its card.

import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';

export const CNC_RECOVERY_NEEDS_CNC_PROJECT =
  'The open project is in Laser mode. A CNC recovery stops at bit changes, where Zero Z and the probe work from the open CNC project. Open the CNC project this job came from, or switch the toolbar to CNC, then start the recovery again. The saved recovery stays on its card, and no controller command was sent.';

/** The recovery card's reminder, beside its note that the run is isolated. */
export const CNC_RECOVERY_OPEN_PROJECT_NOTE =
  'It still starts only with a CNC project open, because its bit changes are worked from that project.';

/** Why a CNC recovery cannot start with the open project, or null. */
export function cncRecoveryOpenProjectIssue(): string | null {
  return machineKindOf(useStore.getState().project.machine) === 'cnc'
    ? null
    : CNC_RECOVERY_NEEDS_CNC_PROJECT;
}

/** The final-assertion form: throws when the open project is not CNC. */
export function assertCncRecoveryOpenProject(): void {
  const issue = cncRecoveryOpenProjectIssue();
  if (issue !== null) throw new Error(issue);
}
