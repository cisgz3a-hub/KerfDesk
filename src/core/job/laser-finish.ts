// Laser finish position (LightBurn gap LBG-M02, ADR-493). Machine Setup's
// "After a job" choice is placed onto the prepared laser job here, once, so
// emission, the preview, the estimate and Job Review all read the same result
// (finishOptionsForJob in core/output). A `bed` finish is a canvas position: it
// enters machine coordinates like the artwork does (toMachineCoords), then
// program coordinates through the same bed-to-program translation that places
// the CNC park (ADR-392). Unknown translation never reads bed numbers as program
// ones: the finish is set aside, the default applies, and Job Review says so.

import type { DeviceProfile } from '../devices/device-profile';
import { toMachineCoords } from '../devices/origin-transform';
import { machineKindOf, type MachineConfig, type Vec2 } from '../scene';
import type { Job, JobLaserFinish } from './job';
import { rotaryAppliesTo } from './rotary-job';

/** Record the configured laser finish on a placed job. CNC jobs keep their own
 * park (placeCncParks) and are returned unchanged, as is a job whose device
 * has no finish configured, so default output stays byte-identical. */
export function placeLaserFinish(
  job: Job,
  device: DeviceProfile,
  machine: MachineConfig | undefined,
  bedToProgram: Vec2 | null,
): Job {
  if (machineKindOf(machine) === 'cnc') return job;
  const finish = resolveLaserFinish(device, machine, bedToProgram);
  return finish === null ? job : { ...job, laserFinish: finish };
}

function resolveLaserFinish(
  device: DeviceProfile,
  machine: MachineConfig | undefined,
  bedToProgram: Vec2 | null,
): JobLaserFinish | null {
  const configured = device.laserFinishPosition;
  if (configured === undefined) return null;
  if (configured.kind === 'stay') return { kind: 'stay' };
  // A rotary turns Y into rotation measured from the job's own start, so a bed
  // Y has no place on it.
  if (rotaryAppliesTo(device, machine)) return { kind: 'set-aside', reason: 'rotary' };
  if (bedToProgram === null) return { kind: 'set-aside', reason: 'unplaced' };
  const bed = toMachineCoords({ x: configured.xMm, y: configured.yMm }, device);
  return { kind: 'point', x: bed.x + bedToProgram.x, y: bed.y + bedToProgram.y };
}
