import { useEffect, useRef, useState } from 'react';
import { laserSecondPassSupportsController } from '../../../core/laser-second-pass/source-family';
import { Dialog, DialogActions } from '../../kit';
import { useLaserStore } from '../../state/laser-store';
import { useLaserSecondPassUiStore } from '../../state/laser-second-pass-ui-store';
import type { ExecutionArtifactV1, RecoveryRepository } from '../../state/recovery';
import { isModalOpen, useUiStore } from '../../state/ui-store';
import { useRecoveryRepositorySnapshot } from '../../state/use-recovery-repository';
import { jobControlsBusy } from '../job-controls-busy';

/** Only a flat laser run whose program the transformer can read is offered;
 * a Marlin or Smoothieware completion would lead straight to a refusal. */
function secondPassOfferable(artifact: ExecutionArtifactV1): boolean {
  return (
    artifact.machineKind === 'laser' &&
    laserSecondPassSupportsController(artifact.prepared.project.device.controllerKind)
  );
}

export function SecondPassCompletionPrompt(props: {
  repository: RecoveryRepository;
}): JSX.Element | null {
  const snapshot = useRecoveryRepositorySnapshot(props.repository);
  const runId = useLaserSecondPassUiStore((s) => s.completionRunId);
  const request = useLaserSecondPassUiStore((s) => s.editorRequest);
  const dismiss = useLaserSecondPassUiStore((s) => s.dismissCompletion);
  const openEditor = useLaserSecondPassUiStore((s) => s.openEditor);
  const activeRunId = useLaserStore((s) => s.activeRunId);
  const busy = useLaserStore(
    (s) =>
      jobControlsBusy(s.streamer?.status, s.motionOperation, s.controllerOperation) ||
      s.autofocusBusy ||
      s.fireActive,
  );
  const modalOpen = useUiStore(isModalOpen);
  const [presentedRunId, setPresentedRunId] = useState<string | null>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const receipt = snapshot.lastCompletedReceipt;
  const matching = receipt?.runId === runId;
  const offerable = receipt != null && matching && secondPassOfferable(receipt.artifact);

  useEffect(() => {
    if (!runId) return;
    if ((activeRunId !== null && activeRunId !== runId) || (matching && !offerable)) {
      dismiss(runId);
    } else if (offerable && !busy && !modalOpen && !request) {
      if (presentedRunId !== runId)
        returnFocusTo.current = document.activeElement as HTMLElement | null;
      setPresentedRunId(runId);
    }
  }, [runId, activeRunId, matching, offerable, busy, modalOpen, request, dismiss, presentedRunId]);

  // modalOpen gates the initial presentation only: this Dialog itself then
  // registers as a modal. Hydrated receipts alone never set completionRunId.
  if (!runId || runId !== presentedRunId || !offerable || busy || request) return null;
  // The offer appears on its own when a job settles, often while the operator
  // is typing in a field: focus the dialog, not a button, so that keystroke
  // cannot answer it (ADR-341 Amendment 3).
  return (
    <Dialog title="Job complete" size="sm" initialFocus="surface" onClose={() => dismiss(runId)}>
      <p>Would you like to darken selected areas?</p>
      <p>
        Paint the parts you want to engrave again or cut deeper, erase any spill, and adjust power
        for each area. Keep the workpiece and work origin in their original positions.
      </p>
      <p>You can also open Paint a second pass later from the Machine panel.</p>
      <DialogActions>
        <button
          className="lf-btn"
          onClick={() => dismiss(runId)}
          title="Close this offer. The saved job remains available for a second pass later."
        >
          Not now
        </button>
        <button
          className="lf-btn lf-btn--primary"
          onClick={() => openEditor(runId, returnFocusTo.current)}
          title="Open this completed job to paint areas for another pass and adjust their power."
        >
          Darken selected areas…
        </button>
      </DialogActions>
    </Dialog>
  );
}
