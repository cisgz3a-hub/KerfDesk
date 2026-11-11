import { useLaserStore } from '../state/laser-store';
import { isWorkZEvidenceCurrentForStart } from '../state/work-z-zero-evidence';
import { CNC_FRAME_WORK_Z_REQUIRED_MESSAGE } from '../state/cnc-frame-lines';
import { waitForFreshIdleFramePosition } from './frame-position-readiness';
import { askMachineOffer } from './machine-offer';
import { reportFramePreparationRefusal } from './frame-dispatch-support';
import { FRAME_ZERO_Z_POSITION_UNREPORTED_MESSAGE } from './frame-position-withheld';

export const ZERO_Z_OFFER_TITLE = 'Set Work Z zero here?';
export const ZERO_Z_OFFER_BUTTON = 'Zero Z here';
export const ZERO_Z_OFFER_PROMPT =
  `${CNC_FRAME_WORK_Z_REQUIRED_MESSAGE}\n\n` +
  `If the bit is touching the stock-top Z reference now, choose "${ZERO_Z_OFFER_BUTTON}" to set ` +
  'Work Z zero and continue preparing Frame. Choose Cancel to jog or probe first.';

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
  // An in-app question (ADR-707): the page keeps running while it is open. A
  // yes counts only while Work Z is still unset, so a probe finished in the
  // meantime is never overwritten.
  const zeroHere = await askMachineOffer(
    { title: ZERO_Z_OFFER_TITLE, message: ZERO_Z_OFFER_PROMPT, confirmLabel: ZERO_Z_OFFER_BUTTON },
    (now) =>
      !isWorkZEvidenceCurrentForStart(
        now.workZZeroEvidence,
        now.workZReferenceEpoch,
        now.controllerSessionEpoch,
      ),
  );
  if (!zeroHere) {
    reportFramePreparationRefusal([CNC_FRAME_WORK_Z_REQUIRED_MESSAGE], wcsNormalizationWarning);
    return null;
  }
  try {
    // Read again after the answer: status reports arrived while the question
    // was open, and one of those must not pass for the position after zeroing.
    const current = useLaserStore.getState();
    const positionSequenceBeforeZero = current.statusSequence;
    await current.zeroZHere();
    if (!(await waitForFreshIdleFramePosition(positionSequenceBeforeZero))) {
      reportFramePreparationRefusal(
        [FRAME_ZERO_Z_POSITION_UNREPORTED_MESSAGE],
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
