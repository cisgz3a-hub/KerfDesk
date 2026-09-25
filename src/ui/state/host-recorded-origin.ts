// The work offset of a controller that reports only its work position
// (capabilities.workOffsetSource 'host-recorded': Marlin). Marlin's M114 prints
// the logical position, with the G92 shift applied (Marlin 2.1.2.8
// motion.cpp:192-212), and no offset field, so KerfDesk keeps the shift it
// writes itself in wcoCache, with GRBL's meaning (machine = work + offset):
//   - a restart and homing clear the shift (motion.cpp:2346-2349
//     `position_shift[axis] = 0;`), so it is none at the start of a session and
//     after Home;
//   - Set origin's `G92 X0 Y0` and Zero Z's `G92 Z0` record the machine
//     position they are written at;
//   - Reset origin writes a G92 that restores machine coordinates, because a
//     stock build compiles no G92.1 (G92.cpp:62-70 needs CNC_COORDINATE_SYSTEMS)
//     and would acknowledge it while keeping the shift.
// A shift set before KerfDesk connected, without a restart since, is invisible
// to it (controller audit 2026-09-25 MA-2, CG-1, CG-11).

import type { LaserState } from './laser-store';
import { inferCurrentMachinePosition } from './infer-machine-position';
import type { WorkCoordinateOffset } from './origin-actions';

export const NO_WORK_OFFSET: WorkCoordinateOffset = { x: 0, y: 0, z: 0 };

export const HOST_RECORDED_RESET_UNKNOWN_MESSAGE =
  'KerfDesk does not know the machine position to restore, so it cannot reset the origin. Wait ' +
  'for a position report and try again, or Home the machine: Marlin clears its origin when it ' +
  'homes.';

/** The offset of a report that carries only the work position: the recorded
 *  shift, or none while KerfDesk has set no origin in this session. */
export function hostRecordedWorkOffset(
  state: Pick<LaserState, 'capabilities' | 'wcoCache' | 'workOriginSource'>,
  report: { readonly mPos: unknown; readonly wPos: unknown },
): WorkCoordinateOffset | null {
  if (state.capabilities.workOffsetSource !== 'host-recorded') return null;
  if (report.wPos === null || report.mPos !== null) return null;
  if (state.wcoCache !== null) return state.wcoCache;
  return state.workOriginSource === 'none' ? NO_WORK_OFFSET : null;
}

/** Where the head is in machine coordinates, on a host-recorded controller. */
export function hostRecordedMachinePosition(
  state: Pick<LaserState, 'capabilities' | 'statusReport' | 'wcoCache'>,
): WorkCoordinateOffset | null {
  if (state.capabilities.workOffsetSource !== 'host-recorded') return null;
  return inferCurrentMachinePosition(state.statusReport, state.wcoCache);
}

/** Zero Z's `G92 Z0` shifts Z to the machine Z it is written at. */
export function hostRecordedZeroZPatch(
  machine: WorkCoordinateOffset | null,
  wcoCache: WorkCoordinateOffset | null,
): Partial<Pick<LaserState, 'wcoCache'>> {
  if (machine === null) return {};
  return { wcoCache: { ...(wcoCache ?? NO_WORK_OFFSET), z: machine.z } };
}

/** The G92 that makes the work position equal the machine position again.
 *  Z is written only when KerfDesk shifted it. */
export function machineFrameRestoreLine(
  machine: WorkCoordinateOffset,
  wcoCache: WorkCoordinateOffset | null,
): string {
  const z = (wcoCache?.z ?? 0) === 0 ? '' : ` Z${machine.z.toFixed(3)}`;
  return `G92 X${machine.x.toFixed(3)} Y${machine.y.toFixed(3)}${z}`;
}

/** After the restoring G92: no origin, no shift. */
export function hostRecordedClearedOriginPatch(): Partial<LaserState> {
  return {
    workOriginActive: false,
    workOriginSource: 'none',
    workZZeroEvidence: null,
    wcoCache: NO_WORK_OFFSET,
    frameVerification: null,
    framedRun: null,
    frameTrace: null,
  };
}
