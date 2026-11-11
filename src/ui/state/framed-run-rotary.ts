// A Frame on a rotary that turns on Z (ADR-695 Amendment 2, rolling audit v14
// Z2-P3-2). The Frame opens with `G92 Z0` at the part's current turn, so the
// Z work offset and work Z change by design during every Frame that starts
// away from turn 0. Comparing them before and after refused the first Frame
// after any turn change as "Controller or machine setup changed during Frame".
// On such a job Z is the part's turn, not a head height, so the comparison
// leaves it out; X, Y, the session and every other identity stay checked. A
// rotary on A was never compared: the snapshots carry XYZ only.

import { rotaryOutputAxis } from '../../core/job/rotary-job';
import type { Project } from '../../core/scene';
import type { StatusAxes, StatusReport } from '../../core/controllers/grbl/status-parser';
import type { WorkCoordinateOffset } from './origin-actions';

type ZSnapshot = {
  readonly statusReport: StatusReport | null;
  readonly wcoCache: WorkCoordinateOffset | null;
};

/** True when the framed job's rotary turns on Z. */
export function framesZRotary(project: Pick<Project, 'device' | 'machine'> | undefined): boolean {
  // Hand-built candidates (older tests, archived permits) may carry no project.
  return project !== undefined && rotaryOutputAxis(project.device, project.machine) === 'Z';
}

/** The snapshot with every Z value set to 0, for a Z-rotary Frame's checks. */
export function withoutRotaryZ<T extends ZSnapshot>(snapshot: T): T {
  const report = snapshot.statusReport;
  return {
    ...snapshot,
    wcoCache: zeroZ(snapshot.wcoCache),
    statusReport:
      report === null
        ? null
        : { ...report, mPos: zeroZ(report.mPos), wPos: zeroZ(report.wPos), wco: zeroZ(report.wco) },
  };
}

function zeroZ<T extends StatusAxes | WorkCoordinateOffset>(axes: T | null): T | null {
  return axes === null ? null : { ...axes, z: 0 };
}
