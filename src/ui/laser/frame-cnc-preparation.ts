import { useLaserStore } from '../state/laser-store';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { isWorkZEvidenceCurrentForStart } from '../state/work-z-zero-evidence';
import { CNC_FRAME_WORK_Z_REQUIRED_MESSAGE } from '../state/cnc-frame-lines';
import { waitForFreshIdleFramePosition } from './frame-position-readiness';
import { reportFramePreparationRefusal } from './frame-dispatch-support';

export async function prepareFrameLaser(
  isCnc: boolean,
  laser: ReturnType<typeof useLaserStore.getState>,
  wcsNormalizationWarning: string | undefined,
  interactiveSetup = true,
): Promise<ReturnType<typeof useLaserStore.getState> | null> {
  if (!isCnc) return laser;
  if (
    isWorkZEvidenceCurrentForStart(
      laser.workZZeroEvidence,
      laser.workZReferenceEpoch,
      laser.controllerSessionEpoch,
    )
  ) {
    return laser;
  }
  if (!interactiveSetup) {
    reportFramePreparationRefusal([CNC_FRAME_WORK_Z_REQUIRED_MESSAGE], wcsNormalizationWarning);
    return null;
  }
  const zeroHere = jobAwareConfirm(
    `${CNC_FRAME_WORK_Z_REQUIRED_MESSAGE}\n\n` +
      'If the bit is touching the stock-top Z reference now, choose OK to set Work Z zero and continue preparing Frame. Choose Cancel to jog or probe first.',
  );
  if (!zeroHere) {
    reportFramePreparationRefusal([CNC_FRAME_WORK_Z_REQUIRED_MESSAGE], wcsNormalizationWarning);
    return null;
  }
  try {
    const positionSequenceBeforeZero = laser.statusSequence;
    await laser.zeroZHere();
    if (!(await waitForFreshIdleFramePosition(positionSequenceBeforeZero))) {
      reportFramePreparationRefusal(
        [
          'Work Z was set, but the controller did not report the fresh Idle position needed to build an exact Frame. Wait for a complete status report, then Frame again.',
        ],
        wcsNormalizationWarning,
      );
      return null;
    }
    return useLaserStore.getState();
  } catch (error) {
    reportFramePreparationRefusal(
      [error instanceof Error ? error.message : String(error)],
      wcsNormalizationWarning,
    );
    return null;
  }
}
