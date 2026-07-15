import type { JobCheckpoint } from '../../core/recovery';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { readJobCheckpoint } from '../state/job-checkpoint-storage';
import { sameCheckpoint } from './start-job-checkpoint-policy';
import { runConfirmedCheckpointReplacementStart } from './start-job-flow';

// Deliberately destructive alternative exposed only beside an interrupted
// laser checkpoint. It is not resume: the same job is compiled and streamed
// from its first line, and already-burned areas may be burned again.
export async function runRestartInterruptedJobFlow(checkpoint: JobCheckpoint): Promise<void> {
  if (checkpoint.machineKind !== 'laser') {
    jobAwareAlert(
      'Cannot restart this interrupted job automatically:\n\nUse the supervised CNC recovery workflow.',
    );
    return;
  }
  const current = readJobCheckpoint();
  if (current === null || !sameCheckpoint(current, checkpoint)) {
    jobAwareAlert(
      'Cannot restart the interrupted job:\n\nThe recovery record changed or was removed. Review the current recovery banner before continuing.',
    );
    return;
  }
  if (
    !jobAwareConfirm(
      'Restart the entire laser job from the beginning?\n\n' +
        'This is NOT resume. It may burn or cut areas that already completed. The interrupted-job ' +
        'checkpoint will be replaced only after the new stream successfully starts.\n\n' +
        'Confirm the machine is safe, homed if position was lost, and using the intended work origin. Continue?',
    )
  ) {
    return;
  }
  await runConfirmedCheckpointReplacementStart(checkpoint);
}
