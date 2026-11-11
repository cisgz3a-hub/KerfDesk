import { useState } from 'react';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import {
  recoveryRepository,
  type LastCompletedReceipt,
  type RecoveryRepository,
  type RecoveryRepositorySnapshot,
} from '../state/recovery';
import { useRecoveryRepositorySelection } from '../state/use-recovery-repository';
import { currentPrintCutOutputRegistration } from './print-cut-output';
import { useExecutionSignatureAppState } from './use-execution-signature-app-state';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { currentCompletedFrame, framedRunReadinessIssue } from './framed-run-readiness';
import { runCompletedJobAgainFlow } from './start-job-flow';
import { useFramedRunLaserState } from './use-framed-run-laser-state';
import { useFreshKeyActivation } from '../common/use-fresh-key-activation';

export { currentReplayExecutionSignature } from './start-job-execution-tracking';

type Props = {
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly repository?: RecoveryRepository;
  readonly onRunAgain?: (receipt: LastCompletedReceipt) => Promise<void>;
};

const RUN_AGAIN_LABEL = 'Run same job again from start';

/** Exact replay is deliberately separate from interrupted-job recovery. The
 * offer exists only while the open execution inputs still match the immutable
 * receipt. Like Start, it reuses clean spatial evidence for unchanged placement
 * and claims its own exact permit; it never Frames itself (ADR-565). An
 * unchanged laser job reviewed in this session starts without showing Job
 * Review again (ADR-237 Amendment 3), so one press can start the laser: a held
 * Enter must never be that press. */
export function RunAgainControl(props: Props): JSX.Element | null {
  const repository = props.repository ?? recoveryRepository;
  const receipt = useRecoveryRepositorySelection(selectLastCompletedReceipt, repository);
  const app = useExecutionSignatureAppState();
  const laser = useFramedRunLaserState();
  const [starting, setStarting] = useState(false);
  const label = starting ? 'Checking completed job…' : RUN_AGAIN_LABEL;
  // Focus can come back to this button when a job ends. An auto-repeated
  // Enter, or one held since before the button meant this, is dropped.
  const freshKeys = useFreshKeyActivation(label);

  // These stores participate in print-and-cut execution identity but are read
  // imperatively by currentPrintCutOutputRegistration. Subscribe explicitly so
  // a registration or trust-epoch change invalidates the visible offer now.
  usePrintCutSessionStore((state) => state.first);
  usePrintCutSessionStore((state) => state.second);
  useLaserStore((state) => state.trustedPositionEpoch);
  useExperimentalLaserFeatures((state) => state.features.printAndCut);

  // The signature fingerprints the whole job, so with no receipt to compare it
  // against it is not worth computing on every edit.
  if (receipt === null) return null;
  const registration = currentPrintCutOutputRegistration(app.project);
  const currentSignature = currentReplayExecutionSignature(app, registration);
  if (receipt.artifact.executionSignature !== currentSignature) return null;
  const framedReady = framedRunReadinessIssue(currentCompletedFrame(laser), app, laser) === null;

  const runAgain = async (): Promise<void> => {
    if (starting) return;
    setStarting(true);
    try {
      if (props.onRunAgain === undefined) {
        await runCompletedJobAgainFlow(receipt, repository);
      } else {
        await props.onRunAgain(receipt);
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void runAgain()}
      {...freshKeys}
      disabled={props.disabled || props.busy || starting || !framedReady}
      title={
        framedReady
          ? 'Run the same completed job from the beginning using its unchanged framed placement. A laser job you reviewed in this session starts without showing Job Review again when nothing has changed.'
          : 'Run again needs a clean Frame of this footprint and placement, like Start. Press Frame job first.'
      }
    >
      {label}
    </button>
  );
}

function selectLastCompletedReceipt(snapshot: RecoveryRepositorySnapshot) {
  return snapshot.lastCompletedReceipt;
}
