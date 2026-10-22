// What a crash screen keeps working after a render crash: the software Abort
// (F60/F65), the project's own Save (audit 27-P2-2), and the store-driven
// dialogs those paths and closing the app still open. Both the root boundary
// and the workspace boundary use them.

import type { PlatformAdapter } from '../../platform/types';
import { Toasts } from '../common';
import type { CrashSave, SoftwareAbort } from '../common/ErrorBoundary';
import { useStore } from '../state';
import { isActiveJob } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { unownedControllerMotion } from '../state/unowned-controller-motion';
import { saveProjectNow } from './confirm-discard';
import { DesktopCloseNotice } from './DesktopCloseNotice';
import { ProjectSaveDialog } from './ProjectSaveDialog';

// A render crash unmounts the Live Motion bar's ABORT, so the crash screen
// needs its own way to request a controller abort. Both closures read the
// store at call time, so they reflect the machine's real state at the moment
// of the crash / click.
export const machineSoftwareAbort: SoftwareAbort = {
  isMotionLive: () => {
    const s = useLaserStore.getState();
    return (
      isActiveJob(s.streamer) ||
      s.controllerOperation !== null ||
      s.motionOperation !== null ||
      s.fireActive ||
      unownedControllerMotion(s) !== null
    );
  },
  trigger: () =>
    void useLaserStore
      .getState()
      .stopJob()
      .catch(() => undefined),
};

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

export function CrashScreenHosts(): JSX.Element {
  return (
    <>
      <DesktopCloseNotice />
      <ProjectSaveDialog />
      <Toasts />
    </>
  );
}
