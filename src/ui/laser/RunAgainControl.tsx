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
import { framedRunReadinessIssue } from './framed-run-readiness';
import { runCompletedJobAgainFlow } from './start-job-flow';
import { useFramedRunLaserState } from './use-framed-run-laser-state';

export { currentReplayExecutionSignature } from './start-job-execution-tracking';

type Props = {
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly repository?: RecoveryRepository;
  readonly onRunAgain?: (receipt: LastCompletedReceipt) => Promise<void>;
};

/** Exact replay is deliberately separate from interrupted-job recovery. The
 * offer exists only while the open execution inputs still match the immutable
 * receipt. Like Start, it unlocks only when a clean Frame of this exact job has
 * issued a permit, and it streams that permit; it never Frames itself
 * (ADR-372 Amendment 1). */
export function RunAgainControl(props: Props): JSX.Element | null {
  const repository = props.repository ?? recoveryRepository;
  const receipt = useRecoveryRepositorySelection(selectLastCompletedReceipt, repository);
  const app = useExecutionSignatureAppState();
  const laser = useFramedRunLaserState();
  const [starting, setStarting] = useState(false);

  // These stores participate in print-and-cut execution identity but are read
  // imperatively by currentPrintCutOutputRegistration. Subscribe explicitly so
  // a registration or trust-epoch change invalidates the visible offer now.
  usePrintCutSessionStore((state) => state.first);
  usePrintCutSessionStore((state) => state.second);
  useLaserStore((state) => state.trustedPositionEpoch);
  useExperimentalLaserFeatures((state) => state.features.printAndCut);

  const registration = currentPrintCutOutputRegistration(app.project);
  const currentSignature = currentReplayExecutionSignature(app, registration);
  const eligible = receipt !== null && receipt.artifact.executionSignature === currentSignature;

  if (!eligible || receipt === null) return null;
  const framedReady = framedRunReadinessIssue(laser.framedRun, app, laser) === null;

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
      disabled={props.disabled || props.busy || starting || !framedReady}
      title={
        framedReady
          ? 'Run the framed job, which is this exact completed job, from line 1 with a new run identity.'
          : 'Run again unlocks when a Frame of this exact job finishes cleanly, like Start. Press Frame job first.'
      }
    >
      {starting ? 'Checking completed job…' : 'Run same job again from start'}
    </button>
  );
}

function selectLastCompletedReceipt(snapshot: RecoveryRepositorySnapshot) {
  return snapshot.lastCompletedReceipt;
}
