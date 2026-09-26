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
import type { ControllerSettingsSnapshot } from '../../core/preflight';
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

// A GRBL-family profile says nothing about the controller the file ends up on.
// KerfDesk cannot connect to PC and stand-alone controllers, so their owners
// pick a GRBL profile and export; there the dwell and pause read differently:
// MASSO and UCCNC take G4 P as milliseconds and Mach3 can be set either way
// (vendor manuals), RepRapFirmware reads P as milliseconds and ends a file job
// at M0 (GCodes.cpp:3908-3909, GCodes2.cpp:760-777), and Smoothieware-based
// controllers such as the Carvera ignore M0 (Robot.cpp:694-696). Shown only
// when no controller confirmed the profile this session (the audit's CNC
// controller research; docs/audits/2026-09-25-controller-full-audit.md).
export const CNC_EXPORT_OTHER_CONTROLLERS_NOTE =
  'This CNC file is written for GRBL, grblHAL and FluidNC, and no controller confirmed it this session. PC and stand-alone controllers read two of its commands differently: MASSO, UCCNC and RepRapFirmware take the G4 P spin-up dwell as milliseconds (Mach3 can be set either way), and some skip M0 or end the job there. Check the file before running it on one of them.';

/** The note for a CNC export on a GRBL-family profile that no connected
 *  controller confirmed this session, or null. A profile whose controller
 *  cannot run CNC jobs gets the warning above instead. */
export function cncExportOtherControllersNote(
  device: DeviceProfile,
  controllerSettings: ControllerSettingsSnapshot | null | undefined,
): string | null {
  // Undefined: the caller has no session to ask, as for the laser note.
  if (controllerSettings !== null) return null;
  const driver = selectControllerDriver(device.controllerKind, device.controllerCommandSet);
  return driver.capabilities.cncJobs ? CNC_EXPORT_OTHER_CONTROLLERS_NOTE : null;
}

/** Pushes a CNC export's controller messages: the warning for a controller
 *  that cannot run CNC jobs, or the note for a GRBL-family profile. */
export function pushCncExportControllerMessages(
  device: DeviceProfile,
  controllerSettings: ControllerSettingsSnapshot | null | undefined,
  push: (message: string, variant: 'warning' | 'info') => void,
): void {
  const advisory = cncExportControllerAdvisory(device);
  if (advisory !== null) push(advisory, 'warning');
  const note = cncExportOtherControllersNote(device, controllerSettings);
  if (note !== null) push(note, 'info');
}
