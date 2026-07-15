import { buildResumeProgram } from '../../core/controllers/grbl';
import { streamingModeForController } from '../../core/devices';
import type { JobCheckpoint } from '../../core/recovery';
import { machineKindOf, type Project } from '../../core/scene';
import {
  rebuildCanvasPlanForGcode,
  reportedWorkPositionMm,
  type CanvasMotionPlan,
} from '../state/canvas-motion-plan';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import type { LaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { confirmLaserModeStartEvidence } from './laser-mode-start-acknowledgement';
import { resumeConfirmation } from './resume-confirmation';
import { markOwnedResumeCheckpoint } from './start-job-checkpoint-policy';

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
): Promise<void> {
  const resume = buildResumeProgram(gcode, fromLine, resumeBuildOptions(project));
  if (resume.kind === 'error') {
    jobAwareAlert(`Cannot resume from line ${fromLine}:\n\n${resume.reason}`);
    return;
  }
  const laserModeStartEvidence = confirmLaserModeStartEvidence(
    project,
    laserModeStartSnapshot,
    jobAwareConfirm,
  );
  if (laserModeStartEvidence === null) return;
  const proceed = jobAwareConfirm(
    resumeConfirmation(machineKindOf(project.machine), fromLine, resume.fromLine),
  );
  if (!proceed) return;
  const checkpointUpdate = markOwnedResumeCheckpoint(
    gcode,
    checkpointToResume,
    new Date().toISOString(),
  );
  if (checkpointUpdate === 'changed') {
    jobAwareAlert(
      'Cannot resume the interrupted job:\n\nThe recovery record changed while resume was being prepared. No controller command was sent; review the current recovery banner and try again.',
    );
    return;
  }
  try {
    const laser = useLaserStore.getState();
    const resumeGcode = resume.lines.join('\n');
    const initialPosition = reportedWorkPositionMm(
      laser,
      laser.controllerSettings?.reportInches === true,
    );
    await laser.startJob(resumeGcode, {
      streamingMode: streamingModeForController(
        project.device.controllerKind,
        project.device.streamingMode,
      ),
      rxBufferBytes: project.device.rxBufferBytes,
      machineKind: machineKindOf(project.machine),
      ...(laserModeStartEvidence === undefined ? {} : { laserModeStartEvidence }),
      canvasPlan: rebuildCanvasPlanForGcode(
        originalCanvasPlan,
        resumeGcode,
        initialPosition ?? undefined,
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobAwareAlert(`Could not resume job:\n\n${message}`);
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
