// ADR-502: counts each started job's measured run time towards the machine it
// ran on, and says when a maintenance reminder falls due. It only reads the
// job's lifecycle: it never touches the job, the controller or the project.

import { useEffect } from 'react';
import { machineKindOf } from '../../core/scene';
import { deviceProfileSignature } from '../laser/device-setup/device-setup-nudge';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useMachineHoursStore, type HoursMachine } from '../state/machine-hours-store';
import { advanceRunClock, RUN_CLOCK_FLUSH_MS, type RunClock } from '../state/machine-hours-tracker';
import { useToastStore } from '../state/toast-store';

export function currentHoursMachine(): HoursMachine {
  const project = useStore.getState().project;
  const kind = machineKindOf(project.machine);
  return {
    signature: deviceProfileSignature(project.device, kind),
    name: project.device.name,
    kind,
  };
}

export function useMachineHoursTracking(): void {
  useEffect(() => {
    let clock: RunClock | null = null;
    // The machine a job started on: the project could change before it ends.
    let machine: HoursMachine | null = null;
    const observe = (): void => {
      const run = useLaserStore.getState().liveCanvasRun ?? null;
      const step = advanceRunClock(clock, run, Date.now());
      // Time and an ending belong to the run that was open before this step.
      const owner = machine ?? currentHoursMachine();
      if (step.clock === null) machine = null;
      else if (!sameRun(clock, step.clock)) machine = currentHoursMachine();
      clock = step.clock;
      if (step.addMs <= 0 && !step.jobEnded) return;
      const due = useMachineHoursStore.getState().addRun(owner, step.addMs, step.jobEnded);
      for (const reminder of due) {
        useToastStore
          .getState()
          .pushToast(
            `Maintenance due on ${owner.name}: ${reminder.label}. Mark it done under Machine hours.`,
            'warning',
          );
      }
    };
    observe();
    const unsubscribe = useLaserStore.subscribe(observe);
    const timer = setInterval(observe, RUN_CLOCK_FLUSH_MS);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, []);
}

function sameRun(left: RunClock | null, right: RunClock): boolean {
  return left !== null && left.plan === right.plan && left.startedAtMs === right.startedAtMs;
}
