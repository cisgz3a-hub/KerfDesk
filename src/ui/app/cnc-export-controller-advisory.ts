// CNC exports are always written in KerfDesk's GRBL CNC dialect: the CNC
// emitter ignores the profile's controller (cnc-grbl-strategy.ts), and so do
// tile export and the surfacing generator. On a profile whose controller
// cannot run KerfDesk CNC jobs (Marlin, Smoothieware, and the file-only Ruida
// profile: `capabilities.cncJobs` false) Save G-code, tile export and
// surfacing export say so (2026-09-25 controller audit, CN-1 and CN-3). It is
// a warning only; the bytes and the save are unchanged (rule 7 / ADR-228). The
// Start path states the same fact as CNC_REQUIRES_GRBL_MESSAGE.
//
// Why it matters there: Marlin 2.1.2.8 reads `G4 P` as milliseconds
// (gcode/motion/G4.cpp:33), and Smoothieware has no M0 pause (Robot.cpp:694-696)
// and reads `G4 P` as milliseconds outside grbl_mode (Robot.cpp:500-511).

import { selectControllerDriver } from '../../core/controllers';
import type { DeviceProfile } from '../../core/devices';
import { machineKindOf, type Project } from '../../core/scene';

export const CNC_EXPORT_GRBL_FAMILY_ADVISORY =
  'This CNC file is written for a GRBL-family controller (GRBL, grblHAL, FluidNC): its G4 P spin-up dwell is in seconds and M0 pauses for each tool change.';

/** The advisory for a CNC program exported for this profile, or null when its
 *  controller runs KerfDesk CNC jobs. */
export function cncExportControllerAdvisory(device: DeviceProfile): string | null {
  const driver = selectControllerDriver(device.controllerKind, device.controllerCommandSet);
  if (driver.capabilities.cncJobs) return null;
  return `${CNC_EXPORT_GRBL_FAMILY_ADVISORY} This profile's controller (${driver.label}) cannot run KerfDesk CNC jobs and may read these commands differently: a spin-up G4 P taken as milliseconds lets the bit plunge before the spindle is at speed, and a skipped M0 cuts the next section with the previous bit. Check the file before running it on this machine.`;
}

/** The same advisory for a project Save, which is a CNC export only for a CNC project. */
export function cncProjectExportAdvisories(project: Project): ReadonlyArray<string> {
  if (machineKindOf(project.machine) !== 'cnc') return [];
  const advisory = cncExportControllerAdvisory(project.device);
  return advisory === null ? [] : [advisory];
}
