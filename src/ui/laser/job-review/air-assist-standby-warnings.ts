// What the operator is told, before Start, about a controller whose own air
// standby timer can stop the pump and hold the program mid-job.
//
// Creality's A1 firmware idles the air pump (and powers the laser module down)
// `$152` seconds after it decides work has finished: 0..100, default 30, and
// 100 means never (Creality wiki, "Description for GRBL configuration
// parameters"). Its shipped 1.0.6 build has dropped the pump seconds after a
// fresh M8 (LightBurn staff: a confirmed firmware bug, fixed in 1.0.7). On the
// maintainer's Falcon A1 Pro this showed as air that "works for a few minutes
// and then stops" and a machine that sits Idle for about a minute mid-burn
// before carrying on. KerfDesk cannot read `$152` on this controller (the
// vendor contract forbids `$$`), so the remedy is named rather than checked.
//
// Advisory only (rule 7 / ADR-228, ADR-345): it never refuses a Start.

import type { DeviceProfile } from '../../../core/devices';
import type { Job } from '../../../core/job';

type StandbyDevice = Pick<DeviceProfile, 'airAssistCommand' | 'airAssistRestartUnreliable'>;

export const AIR_STANDBY_WARNING =
  'This controller idles its air pump and laser module on its own standby timer ($152, default ' +
  '30 s, 100 = never) and its 1.0.6 firmware has been seen dropping the pump mid-job. If air ' +
  'stops after a few minutes or the machine sits Idle mid-burn and then continues, set $152=100 ' +
  'on the controller (or update the firmware past 1.0.6). KerfDesk names such a hold in the live ' +
  'bar and keeps waiting; it does not reset the controller.';

export function detectAirAssistStandbyWarnings(
  job: Job,
  device: StandbyDevice,
): ReadonlyArray<string> {
  if (device.airAssistRestartUnreliable !== true || device.airAssistCommand === 'none') return [];
  return job.groups.some((group) => group.kind !== 'cnc' && group.airAssist)
    ? [AIR_STANDBY_WARNING]
    : [];
}
