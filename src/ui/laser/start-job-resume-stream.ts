import { buildResumeProgram } from '../../core/controllers/grbl';
import { streamingModeForController } from '../../core/devices';
import { markResumeInFlight, type JobCheckpoint } from '../../core/recovery';
import { machineKindOf, type Project } from '../../core/scene';
import {
  rebuildCanvasPlanForGcode,
  reportedWorkPositionMm,
  type CanvasMotionPlan,
} from '../state/canvas-motion-plan';
import { canvasJobTimingPlan } from '../state/canvas-job-timing-plan';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { readJobCheckpoint, writeJobCheckpoint } from '../state/job-checkpoint-storage';
import { useLaserStore } from '../state/laser-store';
import { recoveryRepository } from '../state/recovery';
import type { LaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { confirmLaserModeStartEvidence } from './laser-mode-start-acknowledgement';
import { resumeConfirmation } from './resume-confirmation';
import { markOwnedResumeCheckpoint, sameCheckpoint } from './start-job-checkpoint-policy';
import { finalRecoveryStartAssertion } from './recovery-start-authorization';

// Shared resume back half: build the re-entry program, confirm, suspend
// checkpoint tracking (the resume run has its own numbering — ADR-118), and
// stream it.
export async function streamResumeFromRawLine(
  project: Project,
  gcode: string,
  fromLine: number,
  originalCanvasPlan: CanvasMotionPlan,
  laserModeStartSnapshot: LaserModeStartSnapshot,
  checkpointToResume?: JobCheckpoint,
  preparedController = useLaserStore.getState(),
): Promise<boolean> {
  const resume = buildResumeProgram(gcode, fromLine, resumeBuildOptions(project));
  if (resume.kind === 'error') {
    jobAwareAlert(`Cannot resume from line ${fromLine}:\n\n${resume.reason}`);
    return false;
  }
  const resumeGcode = resume.lines.join('\n');
  const laserModeStartEvidence = confirmLaserModeStartEvidence(
    project,
    laserModeStartSnapshot,
    jobAwareConfirm,
    resumeGcode,
  );
  if (laserModeStartEvidence === null) return false;
  const proceed = jobAwareConfirm(
    resumeConfirmation(machineKindOf(project.machine), fromLine, resume.fromLine),
  );
  if (!proceed) return false;
  const checkpointBeforeStart = readJobCheckpoint();
  const checkpointMarkedAtIso = new Date().toISOString();
  const checkpointUpdate = markOwnedResumeCheckpoint(
    gcode,
    checkpointToResume,
    checkpointMarkedAtIso,
  );
  if (checkpointUpdate === 'changed') {
    jobAwareAlert(
      'Cannot resume the interrupted job:\n\nThe recovery record changed while resume was being prepared. No controller command was sent; review the current recovery banner and try again.',
    );
    return false;
  }
  let finalAuthorizationPassed = false;
  try {
    const laser = preparedController;
    const assertRecoveryStartAuthorized = finalRecoveryStartAssertion(laser);
    await laser.startJob(resumeGcode, {
      ...resumeStreamPlans(project, resumeGcode, originalCanvasPlan, laser),
      assertFinalStartAuthorized: () => {
        assertRecoveryStartAuthorized();
        finalAuthorizationPassed = true;
      },
      streamingMode: streamingModeForController(
        project.device.controllerKind,
        project.device.streamingMode,
      ),
      rxBufferBytes: project.device.rxBufferBytes,
      machineKind: machineKindOf(project.machine),
      ...(laserModeStartEvidence === undefined ? {} : { laserModeStartEvidence }),
    });
    // Manual start-from-line is deliberately outside exact recovery tracking,
    // but an accepted stream changes physical machine state. An older capsule
    // or completed-job receipt must not remain eligible afterward.
    await recoveryRepository.noteUntrackedRunAccepted();
    return true;
  } catch (err) {
    if (!finalAuthorizationPassed) {
      restoreUnacceptedResumeCheckpoint(
        checkpointBeforeStart,
        checkpointMarkedAtIso,
        checkpointUpdate,
      );
    }
    jobAwareAlert(`Could not resume job:\n\n${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function resumeStreamPlans(
  project: Project,
  gcode: string,
  originalCanvasPlan: CanvasMotionPlan,
  laser: ReturnType<typeof useLaserStore.getState>,
) {
  const initialPosition = reportedWorkPositionMm(
    laser,
    laser.controllerSettings?.reportInches === true,
  );
  const canvasPlan = rebuildCanvasPlanForGcode(
    originalCanvasPlan,
    gcode,
    initialPosition ?? undefined,
  );
  const jobTimingPlan = canvasJobTimingPlan(
    gcode,
    project.device,
    initialPosition,
    {
      machineKind: machineKindOf(project.machine),
      controllerSessionEpoch: laser.controllerSessionEpoch,
      positionEpoch: laser.trustedPositionEpoch,
      activeControllerKind: laser.activeControllerKind,
      detectedControllerKind: laser.detectedControllerKind,
    },
    canvasPlan.machineKind,
  );
  return { canvasPlan, jobTimingPlan };
}

function restoreUnacceptedResumeCheckpoint(
  previous: JobCheckpoint | null,
  markedAtIso: string,
  update: 'marked' | 'not-owned',
): void {
  if (previous === null || update !== 'marked') return;
  const current = readJobCheckpoint();
  // Only undo this attempt's marker. A different owner or an accepted/uncertain
  // stream must never regain the original job's acknowledgement numbering.
  if (current !== null && sameCheckpoint(current, markResumeInFlight(previous, markedAtIso))) {
    writeJobCheckpoint(previous);
  }
}

const RESUME_PLUNGE_MM_PER_MIN = 300;

function resumeBuildOptions(project: Project) {
  const machine = project.machine;
  return {
    machineKind: machineKindOf(machine),
    safeZMm: machine?.kind === 'cnc' ? machine.params.safeZMm : 0,
    spindleSpinupSec: machine?.kind === 'cnc' ? machine.params.spindleSpinupSec : 0,
    plungeMmPerMin: RESUME_PLUNGE_MM_PER_MIN,
  } as const;
}
