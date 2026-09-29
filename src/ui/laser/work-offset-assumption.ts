// The zero work offset KerfDesk assumes before the controller reports one
// (controller audit 2, ADR-375). GRBL includes WCO in only some status
// reports: every 10th Idle or 30th busy report, the report right after an
// offset changes, and the first report after a reset. Until one arrives,
// Absolute and Current Position resolve with a zero offset, which is wrong
// when the controller keeps a persistent G54 offset, or a G92 offset that
// grblHAL keeps across a reset. Frame asks for the offset first
// (frame-position-readiness); when none arrives the job is still framed and
// started exactly as before, and Job Review says what was assumed.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L561-L568
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L787

import type { ControllerCapabilities } from '../../core/controllers';
import {
  placementAssumesZeroWorkOffset,
  type MachinePlacementSnapshot,
  type ResolvedJobPlacement,
} from '../job-placement';

export const WORK_OFFSET_ASSUMED_ZERO_WARNING =
  'Work offset not reported: the controller had not sent its work-coordinate offset (WCO) when this job was prepared, so KerfDesk assumed it is zero. If a G54 or G92 offset is set on the controller, the job sits on the bed shifted by that offset from what KerfDesk shows and checks; the physical Frame traced where it will actually run.';

/** GRBL-family drivers answer the realtime `?` with reports that carry an
 * intermittent WCO: field. Only for them does a missing WCO mean "not reported
 * yet": Smoothieware's offset comes from every report's MPos and WPos, and
 * Marlin's is the shift KerfDesk records itself (laser-status-position). */
export function controllerReportsWorkOffset(
  capabilities: Pick<ControllerCapabilities, 'statusQuery' | 'wcs'>,
): boolean {
  return capabilities.statusQuery === 'realtime-report' && capabilities.wcs === 'g92-and-g10';
}

/** The Job Review warning for a preparation placed with the assumed zero. */
export function workOffsetAssumptionWarnings(
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
  machine: MachinePlacementSnapshot & { readonly reportsWorkOffset?: boolean },
): ReadonlyArray<string> {
  if (machine.reportsWorkOffset !== true) return [];
  const startFrom = placement.jobOrigin?.startFrom ?? 'absolute';
  return placementAssumesZeroWorkOffset(startFrom, machine)
    ? [WORK_OFFSET_ASSUMED_ZERO_WARNING]
    : [];
}
