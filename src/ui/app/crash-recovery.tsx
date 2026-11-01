// What a crash screen keeps working after a render crash: the software Abort
// (F60/F65), the project's own Save (audit 27-P2-2), and the store-driven
// dialogs and notices those paths, the controller and closing the app still
// open. Both the root boundary and the workspace boundary use them.

import { machineKindOf, type MachineKind } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { Toasts } from '../common';
import { CrashHostBoundary, type CrashSave, type SoftwareAbort } from '../common/ErrorBoundary';
import { SafetyNoticeBanner } from '../laser/SafetyNoticeBanner';
import { useStore } from '../state';
import { isActiveJob } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { unownedControllerMotion } from '../state/unowned-controller-motion';
import { turnUnownedOutputOff, unownedControllerOutput } from '../state/unowned-controller-output';
import { saveProjectNow } from './confirm-discard';
import { DesktopCloseNotice } from './DesktopCloseNotice';
import { ProjectSaveDialog } from './ProjectSaveDialog';

// A render crash unmounts the Live Motion bar's ABORT, so the crash screen
// needs its own way to request a controller abort. Both closures read the
// store at call time, so they reflect the machine's real state at the moment
// of the crash / click. The crash screen shows a failed Abort (J2-P2-3).
export const machineSoftwareAbort: SoftwareAbort = {
  isMotionLive: () => {
    const s = useLaserStore.getState();
    return (
      isActiveJob(s.streamer) ||
      s.controllerOperation !== null ||
      s.motionOperation !== null ||
      s.fireActive ||
      unownedControllerMotion(s) !== null ||
      unownedControllerOutput(s, projectMachineKind()) !== null
    );
  },
  trigger: () => {
    const laser = useLaserStore.getState();
    const machineKind = projectMachineKind();
    // A laser left on at Idle gets M5, as LASER OFF sends it, not a reset that
    // would clear the work origin (rolling audit v5 J2-P2-1).
    if (unownedControllerOutput(laser, machineKind) !== null) {
      return turnUnownedOutputOff(laser, machineKind);
    }
    return laser.stopJob();
  },
};

function projectMachineKind(): MachineKind {
  return machineKindOf(useStore.getState().project.machine);
}

// Offered only for unsaved work. That also keeps it off a crash before the
// workspace opened, when there is nothing to save yet.
export function projectCrashSave(platform: PlatformAdapter): CrashSave {
  return {
    isNeeded: () => useStore.getState().dirty,
    run: async () => {
      const outcome = await saveProjectNow(platform);
      if (outcome === 'saved' || outcome === 'saved-with-newer-edits') return 'saved';
      return outcome === 'error' ? 'failed' : 'cancelled';
    },
  };
}

// The machine-safety notice (a lost link, a failed stop) shows under a crash
// too: the workspace that floats it over the canvas is gone (rolling audit v5
// J2-P2-3). Without Reconnect, which needs the workspace's platform and
// recovery card, and the root boundary sits outside both. Each host has its
// own boundary, so one that throws cannot take the others or the crash screen.
export function CrashScreenHosts(): JSX.Element {
  return (
    <>
      <CrashHostBoundary>
        <SafetyNoticeBanner />
      </CrashHostBoundary>
      <CrashHostBoundary>
        <DesktopCloseNotice />
      </CrashHostBoundary>
      <CrashHostBoundary>
        <ProjectSaveDialog />
      </CrashHostBoundary>
      <CrashHostBoundary>
        <Toasts />
      </CrashHostBoundary>
    </>
  );
}
