// A running or held job keeps the machine it started with (ADR-416 Amendment 2).
// Jog, Zero Z, probing, Frame and the safe-Z lift before a point move read the
// project's machine live, so a CNC job held at a bit change that Undo, Open or
// Machine Setup turned back to Laser sent its next point move without the Z
// lift (controller meta audit M4-P1-1). The guard sits on the store's setter:
// while a job is active, a state change whose project differs from the live one
// in those fields is refused, whichever command wrote it. Undo, Redo and Open
// check first, so they can stop with their own message.
//
// The lock pins the job's Laser/CNC kind, not whatever the open project had
// (Amendment 3, rolling audit v3 G2-P1-1): a project that is not on the running
// job's kind may still be switched to it, so a CNC job held with a Laser
// project open can get its CNC jog, Zero Z and probe back.
//
// The project store cannot import the laser store (the laser store imports
// it), so the laser store registers how to read the running job's kind.

import type { DeviceProfile } from '../../core/devices';
import { machineKindOf, type MachineKind, type Project } from '../../core/scene';
import { restoreSetupHistoryContext, setupHistoryContextFor } from './setup-history-context';
import type { AppState } from './store';
import { useToastStore } from './toast-store';
import { saveUndoStepName } from './undo-step-names';

type Patch = AppState | Partial<AppState>;
type Setter = (patch: Patch | ((state: AppState) => Patch)) => void;

export const JOB_MACHINE_CHANGE_REFUSED =
  'Finish or stop the running job before changing Laser/CNC or the machine setup. Nothing was changed.';
export const JOB_MACHINE_UNDO_REFUSED =
  'Undo stops here while a job is running: the next step changes Laser/CNC or the machine setup the job uses. Finish or stop the job, then Undo again.';
export const JOB_MACHINE_REDO_REFUSED =
  'Redo stops here while a job is running: the next step changes Laser/CNC or the machine setup the job uses. Finish or stop the job, then Redo again.';
export const JOB_MACHINE_OPEN_REFUSED =
  'Finish or stop the running job before opening this project: it uses a different Laser/CNC mode or machine setup. Nothing was opened.';

// The shared machine fields the live motion paths read: the controller that
// builds jog, probe and retract lines; the bed frame a point move maps through;
// the jog feeds and limits; and Z probing. CNC's own values travel with the
// machine kind (sameJobMachine).
const JOB_MACHINE_DEVICE_KEYS = [
  'controllerKind',
  'controllerCommandSet',
  'bedWidth',
  'bedHeight',
  'origin',
  'homing',
  'maxFeed',
  'framingFeedMmPerMin',
  'cncSubProfile',
  'rotary',
  'noGoZones',
  'zTravelMm',
  'zProbePresent',
  'autofocusCommand',
] as const satisfies ReadonlyArray<keyof DeviceProfile>;

let activeJob: () => boolean = () => false;
let runningJobKind: () => MachineKind | null = () => null;

/** The laser store says whether a job is running, held or paused (isActiveJob),
 *  and the Laser/CNC kind it started with (null when not recorded). */
export function registerActiveJobProbe(
  probe: () => boolean,
  kind: () => MachineKind | null = () => null,
): void {
  activeJob = probe;
  runningJobKind = kind;
}

/** True when `a` and `b` give jog, Zero Z, probing, Frame and the safe-Z lift
 *  the same machine: the same Laser/CNC kind, CNC values and motion fields. */
export function sameJobMachine(a: Project, b: Project): boolean {
  if (a.machine === b.machine && a.device === b.device) return true;
  if (machineKindOf(a.machine) !== machineKindOf(b.machine)) return false;
  if (!sameValue(cncParams(a), cncParams(b))) return false;
  return JOB_MACHINE_DEVICE_KEYS.every((key) => sameValue(a.device[key], b.device[key]));
}

/** True when `a` and `b` hold the same machine setup: the same Laser/CNC kind
 *  and CNC machine, and every machine setting, not only the motion fields.
 *  A remote Undo or Redo across a difference says so (ADR-584 Amendment 1). */
export function sameMachineSetup(a: Project, b: Project): boolean {
  if (a.machine === b.machine && a.device === b.device) return true;
  const kind = machineKindOf(a.machine);
  if (kind !== machineKindOf(b.machine)) return false;
  // A Laser machine is its kind alone; a missing one is Laser.
  return (kind !== 'cnc' || sameValue(a.machine, b.machine)) && sameValue(a.device, b.device);
}

/** Refuses turning `current` into `next` while a job is active, with `message`
 *  as the reason. False (nothing refused) when no job runs, the machine stays,
 *  or a project off the job's Laser/CNC kind is switched onto it. */
export function refuseJobMachineChange(current: Project, next: Project, message: string): boolean {
  if (!activeJob() || sameJobMachine(current, next) || switchesOntoJobKind(current, next)) {
    return false;
  }
  queueMicrotask(() =>
    useToastStore.getState().pushToast(message, 'warning', { key: 'job-machine-lock' }),
  );
  return true;
}

/** Wraps the store's setter so no command changes the job's machine mid-job.
 *  A refused change is dropped whole, with its Undo name and setup context. */
export function jobMachineGuardSetter(set: Setter): Setter {
  return (update) =>
    set((state) => {
      if (!activeJob()) return typeof update === 'function' ? update(state) : update;
      const restoreUndoName = saveUndoStepName(state.project);
      const setupContext = setupHistoryContextFor(state.project);
      const patch = typeof update === 'function' ? update(state) : update;
      const next = patch.project;
      if (
        next === undefined ||
        !refuseJobMachineChange(state.project, next, JOB_MACHINE_CHANGE_REFUSED)
      )
        return patch;
      restoreUndoName();
      restoreSetupHistoryContext(state.project, setupContext);
      return {};
    });
}

function switchesOntoJobKind(current: Project, next: Project): boolean {
  const jobKind = runningJobKind();
  return (
    jobKind !== null &&
    machineKindOf(current.machine) !== jobKind &&
    machineKindOf(next.machine) === jobKind
  );
}

function cncParams(project: Project): unknown {
  return project.machine?.kind === 'cnc' ? project.machine.params : null;
}

// Structural equality for the plain data a project holds: a field rebuilt with
// the same values is the same machine.
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!isRecord(a) || !isRecord(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!sameValue(a[key], b[key])) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
