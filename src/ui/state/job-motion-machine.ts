// The machine the live motion controls serve (ADR-416 Amendment 3, rolling
// audit v3 G2-P1-1). While a job runs or holds it is the job's own: a CNC job
// held at a bit change lifts to its safe Z before an X/Y point move, checks
// Work Z, and offers Z jog, Zero Z and the probe as CNC, whatever project or
// Laser/CNC mode is open. A CNC recovery replays its saved project, so the open
// one need not be the job's. With no job, it is the open project's.

import {
  machineKindOf,
  type MachineConfig,
  type MachineKind,
  type Project,
} from '../../core/scene';
import type { LaserState } from './laser-store';
import { isActiveJob } from './laser-store-helpers';

type RunningJobState = Pick<LaserState, 'streamer' | 'activeJobMachineKind'>;
type RunningJobMachineState = RunningJobState & Pick<LaserState, 'activeJobSafeZMm'>;

/** The Laser/CNC kind a running, held or paused job (isActiveJob) started
 *  with; null while no job is active, or when its kind was not recorded. */
export function runningJobMachineKind(laser: RunningJobState): MachineKind | null {
  return isActiveJob(laser.streamer) ? laser.activeJobMachineKind : null;
}

/** Laser or CNC for jog, Zero Z, the probe and the point-move checks. */
export function motionMachineKind(
  laser: RunningJobState,
  project: Pick<Project, 'machine'>,
): MachineKind {
  return runningJobMachineKind(laser) ?? machineKindOf(project.machine);
}

/** The safe Z a point move lifts to first: the running CNC job's own, else the
 *  open CNC project's. Undefined for laser motion, and for a CNC job whose safe
 *  Z is known from neither, which a point move must then refuse. */
export function pointMoveSafeZMm(
  laser: RunningJobMachineState,
  project: Pick<Project, 'machine'>,
): number | undefined {
  const jobKind = runningJobMachineKind(laser);
  if (jobKind === 'laser') return undefined;
  if (jobKind === 'cnc' && typeof laser.activeJobSafeZMm === 'number') {
    return laser.activeJobSafeZMm;
  }
  return project.machine?.kind === 'cnc' ? project.machine.params.safeZMm : undefined;
}

/** The safe Z a starting job records from the machine it was compiled for;
 *  null for a laser job. */
export function startedJobSafeZMm(
  machineKind: MachineKind | undefined,
  jobMachine: MachineConfig | undefined,
): number | null {
  if (machineKind !== 'cnc' || jobMachine?.kind !== 'cnc') return null;
  return jobMachine.params.safeZMm;
}
