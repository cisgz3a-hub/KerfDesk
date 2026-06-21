// runStartJobFlow — the full Start-job sequence (readiness checks →
// operator confirmation → stream). Extracted from LaserWindow so the
// toolbar button and the Ctrl+Return shortcut (M22, WORKFLOW F-A15) run the
// identical flow. Reads both stores imperatively at call time.
//
// Dialogs go through the job-aware wrappers (H13): pass-through natives
// when no job is active — which is the normal case here, since
// prepareStartJob refuses to run while a job is active — but the
// startJob-failed alert in the catch arm can fire after streaming began,
// and a native dialog there would freeze the ack pump and Stop button.

import { currentOutputScope, useStore } from '../state';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { prepareStartJob } from './start-job-readiness';

export async function runStartJobFlow(): Promise<void> {
  const app = useStore.getState();
  const { project, jobPlacement } = app;
  const laser = useLaserStore.getState();
  const prepared = prepareStartJob(
    project,
    laser.controllerSettings,
    {
      statusReport: laser.statusReport,
      alarmCode: laser.alarmCode,
      hasActiveStreamer: isActiveJob(laser.streamer),
      motionOperationActive: laser.motionOperation !== null,
      controllerOperationActive: laser.controllerOperation !== null,
      autofocusBusy: laser.autofocusBusy,
      workOriginActive: laser.workOriginActive,
      wcoCache: laser.wcoCache,
      frameVerification: laser.frameVerification,
    },
    jobPlacement,
    currentOutputScope(app),
  );
  if (!prepared.ok) {
    const lines = prepared.messages.map((message) => `• ${message}`).join('\n');
    jobAwareAlert(`Cannot start job:\n\n${lines}`);
    return;
  }
  if (prepared.warnings.length > 0) {
    const lines = prepared.warnings.map((message) => `• ${message}`).join('\n');
    if (!jobAwareConfirm(`Controller warning:\n\n${lines}\n\nStart anyway?`)) return;
  }
  try {
    await laser.startJob(prepared.gcode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobAwareAlert(`Could not start job:\n\n${message}`);
  }
}
