// What the operator is told, before Start, about a controller whose own air
// standby timer can stop the pump and hold the program mid-job.
//
// Creality's A1 firmware idles the air pump (and powers the laser module down)
// `$152` seconds after it decides work has finished: 0..100, with 100 reported
// as never (Creality wiki, "Description for GRBL configuration parameters";
// the default is reported as 20 or 30). LightBurn staff call the air cut-off a
// confirmed firmware bug on both the A1 and the A1 Pro. The A1 fix was a 1.0.7
// debug build; A1 Pro firmware is numbered separately (1.0.38 on Creality's
// support page, 2025-08-25), so a version number alone says nothing. On the
// maintainer's Falcon A1 Pro this showed as air that "works for a few minutes
// and then stops" and a machine that sits Idle for about a minute mid-burn
// before carrying on. KerfDesk cannot read `$152` on this controller (the
// vendor contract forbids `$$`), so the remedy is named rather than checked;
// the Console can write it on stock GRBL (ADR-370). The emitter attempts
// repeats after an estimated-time trigger at eligible motion boundaries
// (ADR-462). Long blocks, dwells and M3 dark-boundary deferral can exceed that
// interval; the advisory keeps `$152=100` and firmware qualification as the
// remedy if air still stops.
//
// `$152` is the A1's, in stock-GRBL numbering. On grblHAL, the A1 Pro's
// firmware, `$150`-`$152` are the motor microsteps, and Creality documents no
// air standby setting for the A1 Pro, so there only the firmware remedy is
// named, with a caution against the A1's (ADR-370 Amendment 1).
//
// Advisory only (rule 7 / ADR-228, ADR-345): it never refuses a Start.

import type { DeviceProfile } from '../../../core/devices';
import { airStandbyRemedy, type AirStandbyRemedy } from '../../../core/devices/air-standby-remedy';
import type { Job } from '../../../core/job';
import { AIR_KEEP_ALIVE_SECONDS } from '../../../core/output/air-keep-alive';

type StandbyDevice = Pick<
  DeviceProfile,
  | 'airAssistCommand'
  | 'airAssistRestartUnreliable'
  | 'controllerKind'
  | 'controllerCommandSet'
  | 'machineFamily'
>;

const LEAD: Readonly<Record<AirStandbyRemedy, string>> = {
  'standby-setting':
    'This controller idles its air pump and laser module on its own standby timer ($152, ' +
    '100 = never), and Creality firmware has been seen stopping the pump about 30 s after the ' +
    'air command.',
  'grblhal-falcon':
    'Creality firmware on the Falcon A1 and A1 Pro has been seen stopping the air pump about ' +
    '30 s after the air command.',
  firmware:
    'This machine is set up as one whose firmware cannot be trusted to keep air running ' +
    'inside a job ("Air restart" in Machine Setup).',
};

const IF_AIR_STOPS = 'If air still stops or the machine sits Idle mid-burn and then continues, ';
const FIRMWARE_REMEDY = 'install the latest firmware and confirm with an air test.';

const REMEDY: Readonly<Record<AirStandbyRemedy, string>> = {
  'standby-setting': `${IF_AIR_STOPS}send $152=100 from the Console, or ${FIRMWARE_REMEDY}`,
  'grblhal-falcon':
    `${IF_AIR_STOPS}${FIRMWARE_REMEDY} Do not use the Falcon A1's air settings: Creality ` +
    'documents no air standby setting for the A1 Pro, and on its grblHAL firmware $150-$152 ' +
    'set the motor microsteps.',
  firmware: `${IF_AIR_STOPS}${FIRMWARE_REMEDY}`,
};

/** The Job Review advisory for an air-on job on a device with this remedy. */
export function airStandbyWarning(remedy: AirStandbyRemedy): string {
  return (
    `${LEAD[remedy]} KerfDesk attempts to repeat the air command at eligible motion boundaries ` +
    `after about ${AIR_KEEP_ALIVE_SECONDS} s of estimated motion or dwell time. Long moves, ` +
    'dwells and continuous constant-power (M3) cutting can leave longer gaps; this does not ' +
    `guarantee that the pump stays on. ${REMEDY[remedy]} KerfDesk names such a hold in the ` +
    'live bar and keeps waiting; it does not reset the controller.'
  );
}

export function detectAirAssistStandbyWarnings(
  job: Job,
  device: StandbyDevice,
): ReadonlyArray<string> {
  if (device.airAssistRestartUnreliable !== true || device.airAssistCommand === 'none') return [];
  return job.groups.some((group) => group.kind !== 'cnc' && group.airAssist)
    ? [airStandbyWarning(airStandbyRemedy(device))]
    : [];
}
