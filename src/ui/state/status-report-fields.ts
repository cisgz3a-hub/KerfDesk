// What to say when grblHAL's `$10` keeps a report field from ever arriving
// (controller audit v2 C8-P2-2, ADR-375 Amendment 2). Each sentence names the
// bit and the `$10` to send, where KerfDesk would otherwise ask the operator to
// wait for a status report that can never carry the field. KerfDesk never
// writes `$10` itself.

import type { ControllerCapabilities } from '../../core/controllers/controller-capabilities';
import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl/parse-settings';
import {
  statusReportFieldsOff,
  type StatusReportFieldsOff,
} from '../../core/controllers/grblhal/status-report-mask';

export type { StatusReportFieldsOff };

/** The fields the connected controller's `$10` turns off, or null. */
export function laserStatusReportFieldsOff(laser: {
  readonly capabilities: Pick<ControllerCapabilities, 'statusReportMask'>;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
}): StatusReportFieldsOff | null {
  return statusReportFieldsOff(laser.capabilities, laser.controllerSettings);
}

/** The same, from either a Start snapshot that carries it or the live
 * capabilities and `$$`; null when neither says `$10` turns WCO off. */
export function workOffsetOffFor(machine: {
  readonly statusReportFieldsOff?: StatusReportFieldsOff | null;
  readonly capabilities?: Pick<ControllerCapabilities, 'statusReportMask'>;
  readonly controllerSettings?: ControllerSettingsSnapshot | null;
}): StatusReportFieldsOff | null {
  const fieldsOff =
    machine.statusReportFieldsOff ??
    (machine.capabilities === undefined
      ? null
      : statusReportFieldsOff(machine.capabilities, machine.controllerSettings ?? null));
  return fieldsOff?.workOffsetOff === true ? fieldsOff : null;
}

/** The `$10` setting a sentence below asks for. */
function sendSuggestedMask(off: StatusReportFieldsOff): string {
  return `Send $10=${off.suggestedMask} from the Console to turn it on.`;
}

export function workOffsetOffMessage(off: StatusReportFieldsOff): string {
  return (
    `The controller does not send its work offset (WCO): grblHAL $10=${off.mask} has bit 5 ` +
    `(Work coordinate offset) off. ${sendSuggestedMask(off)}`
  );
}

/** Why the machine position will never arrive, or null when `$10` is not why. */
export function unknownMachinePositionMessage(off: StatusReportFieldsOff | null): string | null {
  return off?.machinePositionUnknown === true ? machinePositionUnknownMessage(off) : null;
}

function machinePositionUnknownMessage(off: StatusReportFieldsOff): string {
  return (
    `The machine position cannot be known: grblHAL $10=${off.mask} reports only the work ` +
    `position (bit 0 off) and no work offset (bit 5 off). Send $10=${off.suggestedMask} from ` +
    'the Console to report the offset.'
  );
}

export function overridesOffMessage(off: StatusReportFieldsOff): string {
  return (
    `The controller does not send its override percentages (Ov): grblHAL $10=${off.mask} has ` +
    `bit 6 (Overrides) off. ${sendSuggestedMask(off)}`
  );
}

/** Why the machine position or work offset is missing, when `$10` is the
 * reason; null when a status report may still bring it. */
export function missingPositionMessage(off: StatusReportFieldsOff | null): string | null {
  if (off === null || !off.workOffsetOff) return null;
  return off.machinePositionUnknown
    ? machinePositionUnknownMessage(off)
    : workOffsetOffMessage(off);
}
