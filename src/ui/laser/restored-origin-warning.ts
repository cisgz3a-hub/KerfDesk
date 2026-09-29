// Job Review's unverified bed-mapping warning, extended when a User or Verified
// Origin job runs from a work origin the controller already had when KerfDesk
// connected, on a machine not homed since (controller audit 2, M-4, ADR-375).
// grblHAL keeps a G92 origin (Set origin here) through a reset and, unless
// `$384=1`, saves it and restores it at power-up; every GRBL-family controller
// keeps a saved G54. Machine position starts at zero at power-up, so without
// Home that origin sits relative to wherever the head stood then. A machine
// not homed always gets the unverified-mapping warning, so the origin's story
// joins it instead of making a second warning. The Frame traces where the job
// lands, so nothing is refused (PROJECT.md non-negotiable 21).
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L833-L838
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/grbllib.c#L358
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/main.c#L47

import type { JobOriginPlacement } from '../../core/job';
import { UNKNOWN_NATIVE_BED_MESSAGE } from '../state/native-bed-frame';
import type { MachineStartSnapshot } from './start-job-readiness';

type RestoredOriginEvidence = Pick<
  MachineStartSnapshot,
  | 'workOriginRestored'
  | 'homingState'
  | 'activeControllerKind'
  | 'detectedControllerKind'
  | 'controllerSettings'
>;

const RESTORED_ORIGIN_LEAD =
  'This work origin was already on the controller when KerfDesk connected; it was not set in ' +
  'this session.';

const RESTORED_ORIGIN_ADVICE =
  'Without Home, position counts from wherever the head stood when the controller last powered ' +
  'up, so this origin may not be where it was set. Check that the Frame traced where the job ' +
  'should run, or Set origin here again.';

/** The warning for a job whose bed position the controller-to-bed mapping
 *  cannot verify, naming a restored origin the job runs from. */
export function unknownNativeBedWarning(
  jobOrigin: JobOriginPlacement | undefined,
  machine: RestoredOriginEvidence,
): string {
  if (!runsFromRestoredOrigin(jobOrigin, machine)) return UNKNOWN_NATIVE_BED_MESSAGE;
  const note = restoredOriginFirmwareNote(machine);
  return [
    UNKNOWN_NATIVE_BED_MESSAGE,
    RESTORED_ORIGIN_LEAD,
    ...(note === null ? [] : [note]),
    RESTORED_ORIGIN_ADVICE,
  ].join(' ');
}

// Absolute and Current Position jobs do not place from the work origin.
function runsFromRestoredOrigin(
  jobOrigin: JobOriginPlacement | undefined,
  machine: RestoredOriginEvidence,
): boolean {
  const startFrom = jobOrigin?.startFrom;
  return (
    (startFrom === 'user-origin' || startFrom === 'verified-origin') &&
    machine.workOriginRestored === true &&
    machine.homingState !== 'confirmed'
  );
}

// `$384`, when this session's `$$` read reported it, says whether this
// controller brings Set origin here back at power-up. Stock GRBL and FluidNC
// clear G92 at every reset, so there it can only be a saved G54 (or a G92 the
// controller kept because it was not reset); other firmware gets no note.
function restoredOriginFirmwareNote(machine: RestoredOriginEvidence): string | null {
  const g92PersistenceDisabled = machine.controllerSettings?.g92PersistenceDisabled;
  if (g92PersistenceDisabled === false) {
    return 'This grblHAL controller keeps Set origin here through a power cycle ($384=0).';
  }
  if (g92PersistenceDisabled === true) {
    return (
      'This grblHAL controller does not restore Set origin here at power-up ($384=1), so this ' +
      'is a saved G54 origin or one it kept through a reset.'
    );
  }
  if (machine.activeControllerKind === 'grblhal' || machine.detectedControllerKind === 'grblhal') {
    return 'grblHAL keeps Set origin here through a power cycle unless $384=1.';
  }
  const stockFamily =
    machine.activeControllerKind === 'grbl-v1.1' || machine.activeControllerKind === 'fluidnc';
  return stockFamily ? 'A saved G54 origin survives a power cycle.' : null;
}
