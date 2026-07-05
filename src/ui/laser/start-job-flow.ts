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

import { buildResumeProgram } from '../../core/controllers/grbl';
import { machineKindOf } from '../../core/scene';
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
      settingsCapability: laser.capabilities.settings,
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
    await laser.startJob(prepared.gcode, {
      streamingMode: project.device.streamingMode,
      rxBufferBytes: project.device.rxBufferBytes,
      machineKind: machineKindOf(project.machine),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobAwareAlert(`Could not start job:\n\n${message}`);
  }
}

// Resume a stopped/errored job from a chosen 1-based line (ADR-103 G7,
// F-CNC27). Same readiness gate as a fresh start; the resume preamble
// rebuilds units/spindle/feed/position and re-enters the cut at the
// recorded depth before replaying the tail.
export async function runStartFromLineFlow(fromLine: number): Promise<void> {
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
    jobAwareAlert(`Cannot resume job:\n\n${lines}`);
    return;
  }
  const machine = project.machine;
  const resume = buildResumeProgram(prepared.gcode, fromLine, {
    safeZMm: machine?.kind === 'cnc' ? machine.params.safeZMm : 0,
    spindleSpinupSec: machine?.kind === 'cnc' ? machine.params.spindleSpinupSec : 0,
    plungeMmPerMin: RESUME_PLUNGE_MM_PER_MIN,
  });
  if (resume.kind === 'error') {
    jobAwareAlert(`Cannot resume from line ${fromLine}:\n\n${resume.reason}`);
    return;
  }
  const proceed = jobAwareConfirm(
    `Resume from line ${fromLine}?\n\nThe machine will restart the spindle, move to the recorded position at safe height, feed back to depth, and replay the rest of the job. The work zero must be UNCHANGED since the original run.`,
  );
  if (!proceed) return;
  try {
    await laser.startJob(resume.lines.join('\n'), {
      streamingMode: project.device.streamingMode,
      rxBufferBytes: project.device.rxBufferBytes,
      machineKind: machineKindOf(project.machine),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobAwareAlert(`Could not resume job:\n\n${message}`);
  }
}

const RESUME_PLUNGE_MM_PER_MIN = 300;
