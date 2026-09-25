// One answer to "may Fire be pressed now, and if not, why" for both the Fire
// button's note and the Fire action's own refusal, so the two cannot drift.
// ADR-162 as amended by ADR-387: no Labs switch; the machine's "Enable Fire
// button" opt-in is the consent, and every machine-state precondition stays.

import { selectControllerDriver } from '../../core/controllers';
import type { DeviceProfile, LaserFireControl } from '../../core/devices';
// Deep import: the devices barrel is at its public-export ratchet.
import {
  enabledFireControl,
  fireButtonPercent,
  fireButtonPowerS,
  fireOfferIssue,
  firePowerIssue,
  type FireControllerSupport,
} from '../../core/devices/fire-availability';
import { machineKindOf, type Project } from '../../core/scene';
import type { LaserState } from './laser-store';
import { isActiveJob, mpgCommandBlockMessage } from './laser-store-helpers';

export const FIRE_NOT_ENABLED_MESSAGE =
  'Fire is off for this machine. Turn on "Enable Fire button" in Machine Setup first.';

/** What the Fire control is for the active project, before machine state. */
export type FireSetup =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'needs-setup'; readonly reason: string }
  | {
      readonly kind: 'enabled';
      readonly control: LaserFireControl;
      readonly percent: number;
      readonly powerS: number;
    };

/** A refusal: a few words for the button face and the full sentence. */
export type FireBlock = { readonly caption: string; readonly message: string };

const HIDDEN: FireSetup = { kind: 'hidden' };

/** The Fire facts of the profile's own driver, which decide the opt-in. */
export function profileFireController(device: DeviceProfile): FireControllerSupport {
  const driver = selectControllerDriver(device.controllerKind, device.controllerCommandSet);
  return { label: driver.label, lowPowerFire: driver.capabilities.lowPowerFire };
}

export function fireSetupForProject(project: Project): FireSetup {
  if (machineKindOf(project.machine) !== 'laser') return HIDDEN;
  const device = project.device;
  const controller = profileFireController(device);
  const offerIssue = fireOfferIssue(device, controller);
  if (offerIssue !== null) return { kind: 'unavailable', reason: offerIssue };
  const control = enabledFireControl(device, controller);
  if (control === null) return { kind: 'needs-setup', reason: FIRE_NOT_ENABLED_MESSAGE };
  const powerIssue = firePowerIssue(control, device.maxPowerS);
  if (powerIssue !== null) {
    return { kind: 'needs-setup', reason: `${powerIssue} Raise Fire power in Machine Setup.` };
  }
  return {
    kind: 'enabled',
    control,
    percent: fireButtonPercent(control),
    powerS: fireButtonPowerS(control, device.maxPowerS),
  };
}

/** Why a press would be refused now, or null. The Fire action enforces this. */
export function fireActivationBlock(
  state: LaserState,
  project: Project,
  ignorePendingAcks = false,
): FireBlock | null {
  return (
    fireSetupBlock(project) ?? fireControllerBlock(state) ?? fireBusyBlock(state, ignorePendingAcks)
  );
}

function fireSetupBlock(project: Project): FireBlock | null {
  const setup = fireSetupForProject(project);
  if (setup.kind === 'hidden') return block('CNC project', 'Fire is unavailable for CNC projects.');
  if (setup.kind === 'unavailable') return block('Unavailable', setup.reason);
  return setup.kind === 'needs-setup' ? block('Set up', setup.reason) : null;
}

function fireControllerBlock(state: LaserState): FireBlock | null {
  if (state.connection.kind !== 'connected') {
    return block('Not connected', 'Connect to the laser first.');
  }
  if (!state.capabilities.lowPowerFire) {
    return block('Unsupported', 'The connected controller does not support Fire.');
  }
  const mpgBlock = mpgCommandBlockMessage(state);
  if (mpgBlock !== null) return block('MPG active', mpgBlock);
  if (state.alarmCode !== null) {
    return block('Alarm', 'Clear the controller alarm before using Fire.');
  }
  return fireStatusBlock(state.statusReport);
}

function fireStatusBlock(report: LaserState['statusReport']): FireBlock | null {
  if (report === null) {
    return block(
      'No status',
      'Controller status is not known yet. Wait for an Idle position report.',
    );
  }
  if (report.state !== 'Idle') {
    return block('Not idle', `Machine must be Idle before using Fire (currently ${report.state}).`);
  }
  return report.mPos === null && report.wPos === null
    ? block('No position', 'Fire needs a trusted live position report from the controller.')
    : null;
}

function fireBusyBlock(state: LaserState, ignorePendingAcks: boolean): FireBlock | null {
  if (isActiveJob(state.streamer)) {
    return block('Job running', 'A job is active. Request ABORT before using Fire.');
  }
  if (state.motionOperation !== null) {
    return block('Moving', 'Wait for the jog or frame operation to finish.');
  }
  if (state.controllerOperation !== null) {
    return block('Busy', 'Wait for the controller operation to finish.');
  }
  if (state.autofocusBusy) return block('Focusing', 'Wait for auto-focus to finish.');
  if (state.probeBusy) return block('Probing', 'Wait for probing to finish.');
  if (!ignorePendingAcks && state.pendingUntrackedAcks > 0) {
    return block('Waiting', 'Wait for the controller to acknowledge the previous command.');
  }
  return null;
}

function block(caption: string, message: string): FireBlock {
  return { caption, message };
}
