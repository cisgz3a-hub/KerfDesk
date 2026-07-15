import { useState } from 'react';
import { useStore } from '../state';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import {
  recoveryRepository,
  type LastCompletedReceipt,
  type RecoveryRepository,
} from '../state/recovery';
import { useRecoveryRepositorySnapshot } from '../state/use-recovery-repository';
import { currentPrintCutOutputRegistration } from './print-cut-output';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { runCompletedJobAgainFlow } from './start-job-flow';

export { currentReplayExecutionSignature } from './start-job-execution-tracking';

type Props = {
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly repository?: RecoveryRepository;
  readonly onRunAgain?: (receipt: LastCompletedReceipt) => Promise<void>;
};

/** Exact replay is deliberately separate from interrupted-job recovery. The
 * offer exists only while the open execution inputs still match the immutable
 * receipt; clicking performs a fresh compile and final fingerprint check. */
export function RunAgainControl(props: Props): JSX.Element | null {
  const repository = props.repository ?? recoveryRepository;
  const snapshot = useRecoveryRepositorySnapshot(repository);
  const app = useStore();
  const receipt = snapshot.lastCompletedReceipt;
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
      disabled={props.disabled || props.busy || starting}
      title="Freshly compile this exact completed job, verify its fingerprint, and run it from line 1 with a new run identity."
    >
      {starting ? 'Checking completed job…' : 'Run same job again from start'}
    </button>
  );
}
