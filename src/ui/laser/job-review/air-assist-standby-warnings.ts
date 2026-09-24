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
// the Console can write it (ADR-370).
//
// Advisory only (rule 7 / ADR-228, ADR-345): it never refuses a Start.

import type { DeviceProfile } from '../../../core/devices';
import type { Job } from '../../../core/job';

type StandbyDevice = Pick<DeviceProfile, 'airAssistCommand' | 'airAssistRestartUnreliable'>;

export const AIR_STANDBY_WARNING =
  'This controller idles its air pump and laser module on its own standby timer ($152, ' +
  '100 = never) and Creality firmware has been seen dropping the pump mid-job. If air ' +
  'stops after a few minutes or the machine sits Idle mid-burn and then continues, send $152=100 ' +
  'from the Console, or install the latest firmware and confirm with an air test. KerfDesk ' +
  'names such a hold in the live bar and keeps waiting; it does not reset the controller.';

export function detectAirAssistStandbyWarnings(
  job: Job,
  device: StandbyDevice,
): ReadonlyArray<string> {
  if (device.airAssistRestartUnreliable !== true || device.airAssistCommand === 'none') return [];
  return job.groups.some((group) => group.kind !== 'cnc' && group.airAssist)
    ? [AIR_STANDBY_WARNING]
    : [];
}
