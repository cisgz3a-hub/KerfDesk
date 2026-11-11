// The form of Frame's in-place fix offers (ADR-367): Home, Unlock, Set origin
// here, Zero Z here and Restore origin. They were native OK/Cancel boxes whose
// text had to explain its own buttons; each is now an in-app question whose
// button names the action (ADR-707; annoyance audit A1-P3-8). What is offered,
// and its safety wording, is unchanged.
//
// A native box froze the page, so the controller could not be seen to change
// while it was open. This one does not. So a yes counts only if the controller
// is still the one that was asked about, in the state the question described;
// otherwise nothing is sent and the operator is told to Frame again.
//
// The yes of every offer sends the machine a command, so the dialog opens with
// focus on itself, not on the button: an Enter or Space on its way to another
// control cannot home or unlock the machine (ADR-207 Amendment 3).

import { appConfirm } from '../state/app-dialogs';
import { ACTIVE_JOB_COMMAND_MESSAGE } from '../state/laser-store-helpers';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';

export type MachineOffer = {
  readonly title: string;
  readonly message: string;
  /** Names the action: "Home now", "Unlock", "Set origin here". */
  readonly confirmLabel: string;
};

export const MACHINE_CHANGED_WHILE_ASKED_MESSAGE =
  'The controller changed while the question was open, so nothing was sent. Frame the job again.';

/**
 * Asks the operator. True only when they chose the named action and, at that
 * moment, the controller session is the one that was asked about and
 * `stillApplies` holds for its current state.
 */
export async function askMachineOffer(
  offer: MachineOffer,
  stillApplies: (laser: LaserState) => boolean = () => true,
): Promise<boolean> {
  const sessionWhenAsked = useLaserStore.getState().controllerSessionEpoch;
  const accepted = await appConfirm({
    ...offer,
    initialFocus: 'surface',
    refuseDuringJob: ACTIVE_JOB_COMMAND_MESSAGE,
  });
  if (!accepted) return false;
  const laser = useLaserStore.getState();
  if (laser.controllerSessionEpoch === sessionWhenAsked && stillApplies(laser)) return true;
  useToastStore.getState().pushToast(MACHINE_CHANGED_WHILE_ASKED_MESSAGE, 'warning');
  return false;
}
