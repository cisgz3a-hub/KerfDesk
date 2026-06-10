// runStartJobFlow — the full Start-job sequence (readiness checks →
// operator confirmation → stream). Extracted from LaserWindow so the
// toolbar button and the Ctrl+Return shortcut (M22, WORKFLOW F-A15) run the
// identical flow. Reads both stores imperatively at call time.
//
// The native alert/confirm here are safe: prepareStartJob refuses to run
// while a job is active (hasActiveStreamer), so these dialogs can never
// block a live burn's Stop button (H13's constraint).

import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { prepareStartJob } from './start-job-readiness';

export async function runStartJobFlow(): Promise<void> {
  const { project, jobPlacement } = useStore.getState();
  const laser = useLaserStore.getState();
  const prepared = prepareStartJob(
    project,
    laser.controllerSettings,
    {
      statusReport: laser.statusReport,
      alarmCode: laser.alarmCode,
      hasActiveStreamer:
        laser.streamer !== null &&
        (laser.streamer.status === 'streaming' || laser.streamer.status === 'paused'),
      autofocusBusy: laser.autofocusBusy,
      workOriginActive: laser.workOriginActive,
      wcoCache: laser.wcoCache,
    },
    jobPlacement,
  );
  if (!prepared.ok) {
    const lines = prepared.messages.map((message) => `• ${message}`).join('\n');
    window.alert(`Cannot start job:\n\n${lines}`);
    return;
  }
  if (prepared.warnings.length > 0) {
    const lines = prepared.warnings.map((message) => `• ${message}`).join('\n');
    if (!window.confirm(`Controller warning:\n\n${lines}\n\nStart anyway?`)) return;
  }
  try {
    await laser.startJob(prepared.gcode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    window.alert(`Could not start job:\n\n${message}`);
  }
}
